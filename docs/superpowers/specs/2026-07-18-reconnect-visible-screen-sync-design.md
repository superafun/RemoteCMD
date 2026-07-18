# 重连同步改造：只同步可见屏幕（headless 终端 + 序列化）

日期：2026-07-18
状态：设计已批准，分阶段实现（Phase 1 先全量直发验证，Phase 2 再加逐行 diff 增量）

## 1. 背景与根因

### 现状（`server.js` 的 `buffer` 机制）
- 服务端为每个会话维护一个**原始字节流** `sessions[id].buffer`：PTY 每吐一字节就 `+=`（`server.js:206`），上限 `maxBufferChars`（默认 10MB = 1000 万字符，`server.js:208-209` 滞回截断）。
- 客户端重连/切会话时，把它屏幕上**最后 4096 字符**（`clientTailMax`）作为 `tail` 发上来（`term-session.js:71-78`）。
- 服务端拿 `tail` 去这 1000 万字符的流里匹配（`server.js:290-316`）：
  - `buf.endsWith(tail)` → 未变更，发空；
  - `buf.lastIndexOf(tail)` 找到 → 只发 `tail` 之后的增量；
  - 都找不到 → 发流的最后 `maxBufferChars` 全量。

### 根本缺陷
它把"屏幕"建模成**一维字节流**，而 TUI 屏幕是**二维网格（rows×cols）**。一个只在角落刷新的 TUI 会把海量动画帧灌进字节流：
- `tail` 往往落在这些动画帧里 → 服务端只回"tail 之后的动画增量"，可见屏幕的静止部分整片丢失；
- 或回放最后 1000 万字符从中段重放 → 前面没有清屏指令先出乱码，直到碰到一个清屏才正常。

**用户具象例子**：界面只显示 10 个字符、末字符被反复删建 100 万次。旧方案把这 100 万次全算进历史字节串，超缓存后客户端只见到那个跳动字符、前面 9 个看不到。

### 关键澄清（用户 2026-07-18 纠正）
- **两种"历史"必须区分**：旧方法的"历史"= 原始字节流尾巴（100 万次动画帧的**垃圾**）→ 不该发；新方法的"历史"= headless 终端维护的**真实滚上去的历史行** → 该发、用户重连后要能往上滚看。绝不能用 `scrollback:0`（那只发视口、重连后不能上滚）。

### 利好发现
所有会话共享单一 `current_size` 尺寸（`resizeAllPtys` 一次性 resize 全部 PTY，`current_size` 全局广播，`server.js:104`、`server.js:330-341`）。故 headless 终端尺寸 = 该槽位即与所有客户端对齐，**无尺寸错位问题，无需处理多尺寸重排**。

## 2. 目标

重连/切会话时，客户端拿到：
1. **完整且正确的当前可见屏幕**（整屏 rows×cols，含 TUI 静止部分，不被动画淹没）；
2. **可上滚查看的真实旧历史**（headless 维护的有界 scrollback，不是动画垃圾）；
3. **有界传输**：不再有每会话 10MB 原始字节串；序列化产物大小受 scrollback 行数上限约束。

## 3. 选定方案

服务端给每个会话跑一个**无界面（headless）xterm 终端**，喂同一份 PTY 字节流，由它把流持续"折叠"成当前屏幕状态 + 维护真实滚屏历史。重连时序列化这份屏幕发客户端。

被否的备选方案 B（peer 客户端互传屏幕）：单标签页刷新时无"另一客户端"，最常见场景失效，仅可作未来补充。

### 组件与依赖
- 新增依赖：`@xterm/headless`、`@xterm/addon-serialize`（版本对齐已装的 `@xterm/xterm`）。
- 每个会话新增 `sessions[id].screen` = headless Terminal 实例。

### headless 终端配置
- `scrollback: N`（`N` 为有界行数，可配置，默认约 1000）——保留真实历史、可上滚。
- `allowProposedApi: true`，加载 `Unicode11Addon`（与客户端一致，保证字符宽度/换行对齐）。
- 尺寸 = `sizeSlots[config.currentSize]`（rows×cols）。

## 4. 数据流（协议）

### 客户端 `requestBuffer()`（`term-session.js:71`）
- 不再发 `tail` 字节尾，改为发**当前可见屏幕指纹 `screenHash`**：
  - 读取 `term.buffer.active` 可见视口的每行文本（`getLine(i).translateToString()`，`i` 从 0 到 `rows-1`），拼接后算哈希（可用轻量字符串哈希或 `crypto.subtle`）。
  - 全新/无屏场景发空哈希（表示"我啥都没有"）。
- 消息形状：`{ type:'buffer', id, screenHash }`。

### 服务端 `buffer` 处理（`server.js:290`）
- 算 `serverHash` = headless 视口 hash（同口径）。
- `serverHash === screenHash` → 发 `{ type:'buffer', id, data:'' }`（**0 字节载荷**，客户端保持原样）。
- 否则 → `serializeAddon.serialize()` 得到**整个 buffer（可见视口 + scrollback）**的 ANSI 文本，发 `{ type:'buffer', id, data:<ansi>, reset:true }`。
  - 因 `scrollback:N` 有界，`serialize()` 产物大小有上限（极端 200×200×1000 行约数 MB，正常远小于此）。

### 客户端 `handleBufferResponse()`（`term-session.js:81`）
- `data === ''` → 跳过（'skip'）；
- 否则 `term.reset(); term.write(ansi)` 重建整屏（视口 + 可上滚历史）。
- 随后实时 `data` 广播自动从同步点继续：同步覆盖 [断连→T0]，实时流覆盖 [T0→]，**无重复无缺口**。

## 5. 分阶段实现

### Phase 1 —— 全量直发（最小可测版，先验证核心机制）
- 实现 §3/§4 全部内容，但**不做 diff 增量**，不匹配成功即整屏全量发回。
- 保留旧 `buffer`/`maxBuffer` 字节流逻辑作**临时兜底**：通过配置项 `syncMode: 'screen' | 'legacy'`（默认 `'screen'`）切换，便于安卓真机验证不顺时一键回退；验证稳定后删除 `legacy` 分支与配置项，并删除 `sessions[id].buffer` 相关逻辑与 `maxBufferChars`。
- 目的：用最少代码验证 "headless 屏幕 + serialize + reset/write" 这套核心机制**确实修好了 TUI bug**（安卓真机验），再投入增量代码。

### Phase 2 —— 逐行 diff 增量
- 客户端在 `requestBuffer()` 中改发**整屏**（可见视口 + scrollback 的每行文本数组 + 尺寸），作为 diff 基准上传（本地、便宜）。
- 服务端将客户端整屏与自身屏幕**逐行比对**，只回"哪些行变了 + 内容"：`{ type:'buffer', id, rows:[{row, text}, ...], reset:false }`；变化行数超过阈值则降级为整屏全量（`reset:true`）。
- 客户端按 `row` 定位、写入对应行（用 ANSI 光标定位 `\x1b[<row>;1H` 或直接 `term.write`）。
- 收益：滚屏 shell 与 TUI 都省流量——TUI 只动一个时钟格就只回那 1 行。
- 此阶段删除 Phase 1 的 `syncMode` 兜底（已不需要）。

> 注：旧"字节 tail 块匹配"式增量**不能复用**（正是 TUI bug 根源）；屏幕版增量只能是"行"单位。块匹配（客户端传可见行、服务端块匹配发后缀）对 TUI 无效（每帧整屏变、行块对不上仍全量），故 Phase 2 用逐行 diff 而非块匹配。

## 6. 边界与兜底

- **write 同步性**：确认 headless `write` 后 `term.buffer.active` 已反映最新字节再 `serialize()`（必要时 `await` 微任务或写回调），避免读到半成品屏幕。
- **尺寸对齐**：headless 尺寸随 `resizeAllPtys` 同步（`server.js:104`），与所有客户端同尺寸，无错位。
- **大小保护**：设 `maxSyncBytes` 硬上限，超限降级走 legacy 全量字节流兜底（仅 Phase 1 期间有效）。
- **异常兜底**：headless 解析/`serialize` 抛错时 try-catch，降级为"不发屏、靠实时流恢复"或 legacy 全量，**绝不崩**。
- **内存**：废弃旧 10MB 字节串后，每会话仅持有一个 headless 屏幕（rows×cols×cells，极小）。

## 7. 配置变更

- 废弃 `maxBuffer`（10MB，仅服务于旧重连同步字节流）、`clientTailMax`（4096，旧 tail 机制）：Phase 1 保留 `syncMode` 兜底；验证稳定后从 `config.json` 与设置 UI 移除这两项，并新增 `screenHistoryLines`（headless scrollback 行数，默认约 1000）替代 `maxBuffer` 的"历史量"语义。
- `client_tail_max` 广播（`server.js:249`、`server.js:423-425`）在移除 `clientTailMax` 时一并清理。

## 8. 测试验证

- **TUI 高频刷新**：top / vim 运行中重连 → 客户端显示**完整整屏**（含静止部分），而非只有刷新角。
- **用户例子**：10 字符屏、末字符删建 100 万次 → 重连只同步最终 10 字符；服务端内存/发送都不含那 100 万操作。
- **可上滚历史**：重连后客户端能往上滚看到真实旧历史（非动画垃圾）。
- **未变更**：重连时屏幕没变 → 服务端发 0 字节（指纹命中）。
- **尺寸切换后重连**：切 `current_size` 再重连，屏幕分辨率正确。
- **内存**：多会话下确认不再有每会话 10MB 原始字节串。
- **安卓真机**：Phase 1 在安卓真机验证核心机制有效后，再推进 Phase 2。

## 9. 实现注意（落地时核对）

- `createSession` 处创建 headless 终端并加载 `Unicode11Addon` + `SerializeAddon`；
- `ptyProcess.onData`（`server.js:205`）除原有逻辑外增加 `sessions[id].screen.write(d)`；
- `resizeAllPtys`（`server.js:104`）同步 resize headless 终端；
- 客户端 `requestBuffer` / `handleBufferResponse` 改写（§4）；
- 新增依赖需 `npm install` 并确认与 `@xterm/xterm` 版本兼容；
- 删除旧 `buffer`/`maxBuffer` 逻辑与 `syncMode` 兜底（Phase 1 验证后）。
