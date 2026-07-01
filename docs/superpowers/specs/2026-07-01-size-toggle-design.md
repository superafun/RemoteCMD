# 终端尺寸切换与大/小尺寸独立设置设计

## 目标

在顶栏新增一个"大/小尺寸切换"按钮，并在设置弹窗中提供大/小尺寸各自的行/列配置。复用 WebSocket 通信，但用新的 `size_slots` 和 `current_size` 消息替代旧的 `resize` 消息。旧 `resize` 消息整条删除（双向都删）。

## 用户故事

1. 用户首次进入页面：终端为"大尺寸"（60×120），按钮显示"大"。
2. 用户点切换按钮：终端立即变为"小尺寸"（24×80），按钮文字切换为"小"。
3. 用户点"设置"：弹窗中有「大尺寸」和「小尺寸」两节，每节有独立的行/列输入框。
4. 用户修改大尺寸行/列并点"应用"：终端立即按新尺寸调整，按钮显示"大"。
5. 用户修改小尺寸行/列并点"应用"：终端立即按新尺寸调整，按钮显示"小"。
6. 用户下次重新打开页面：终端使用上次切换的尺寸（记忆 last state）。

## 协议变更

### 删除

- 旧的 `resize` 消息：客户端 → 服务端、服务端 → 客户端 双向删除。
- 客户端 `let rows = null, cols = null;` 全局变量。
- 客户端 `applySettingsSize()` 函数及对应的设置弹窗行/列输入项。
- 客户端 TermSession 构造里的 `if (Number.isInteger(rows) && Number.isInteger(cols)) this.term.resize(cols, rows);` 守卫（依赖 current_size 消息到达后再 resize）。
- 服务端 `config.rows / config.cols` 顶层字段及相关读写。

### 新增

| 方向 | 消息 | 载荷 | 行为 |
|------|------|------|------|
| C → S | `size_slots` | `{sizeMode: 'large'\|'small', rows, cols}` | 写 `config.sizeSlots[sizeMode]`、落盘、全量广播 |
| S → C | `size_slots` | `{data: {large: {rows, cols}, small: {rows, cols}}}` | 全量广播；客户端无脑覆盖 `sizeSlots` |
| C → S | `current_size` | `{size: 'large'\|'small'}` | 切 `config.currentSize`、调整所有 PTY、落盘、广播 |
| S → C | `current_size` | `{data: 'large'\|'small'}` | 广播当前尺寸 |

### 服务端大小校验

- `rows` / `cols` 范围 20-200，必须为整数。非法值整条消息拒收（不写盘、不广播）。
- `sizeMode` / `size` 必须是 `'large'` 或 `'small'`，其他值拒收。
- `current_size` 中 `size === config.currentSize` 时直接跳过（不广播、不写盘）。

## 数据模型

### config.json

```json
{
  "sizeSlots": {
    "large": { "rows": 60, "cols": 120 },
    "small": { "rows": 24, "cols": 80 }
  },
  "currentSize": "large",
  "hotkeys": {},
  "scrollInterval": 100,
  "maxBuffer": 10,
  "maxFrontendLogs": 50,
  "clientTailMax": 4096
}
```

### 客户端全局

```javascript
// 替换原 let rows = null, cols = null;
let sizeSlots = { large: null, small: null };
let currentSize = null;  // 'large' | 'small' | null
```

## 触发动作分解

| 行为 | 触发点 | 客户端发送 | 服务端响应 |
|------|--------|------------|------------|
| 切换大/小 | 顶栏按钮 | `current_size` 一条 | 切 currentSize + 调 PTY + 落盘 + 广播 current_size |
| 修改大尺寸行/列 | 设置弹窗大尺寸"应用" | **先** `size_slots(sizeMode='large', rows, cols)` **再** `current_size(size='large')` | 写 sizeSlots.large + 落盘 + 广播 size_slots；切 currentSize + 调 PTY + 落盘 + 广播 current_size |
| 修改小尺寸行/列 | 设置弹窗小尺寸"应用" | **先** `size_slots(sizeMode='small', rows, cols)` **再** `current_size(size='small')` | 同上，sizeMode='small' |
| 新建会话 | 创建按钮 | — | 服务端用 `sizeSlots[currentSize].rows/cols` 启动 PTY |
| 新连接 | 客户端连上 | — | 服务端发 list + size_slots(全量) + current_size + 其他 |

## UI 变更

### 顶栏按钮

位置：「设置」按钮之后、`#wsStatus` 之前。

```html
<button id="sizeToggleBtn" onclick="toggleSize()">大</button>
```

- 初始文字 "大"（占位，连接后由 current_size 消息覆盖）
- 复用 `.toolbar button` 样式（已含 `min-width: 60px` 防 flex 压缩）
- 复用 `line-height: 1.4` 通用规则

### 设置弹窗

**删除**原"终端大小"那一行（行/列输入 + 应用按钮）。

**新增**两节上下排列，每节有独立的行/列输入 + 应用按钮：

```javascript
// 大尺寸
'<div class="modal-row" style="flex-direction:column;align-items:flex-start;gap:4px;">' +
  '<div style="color:#a0a0a0;">大尺寸</div>' +
  '<div style="display:flex;gap:6px;align-items:center;">' +
    '行 <input type="number" id="settingsLargeRowsInput" min="20" max="200" style="width:80px;">' +
    '列 <input type="number" id="settingsLargeColsInput" min="20" max="200" style="width:80px;">' +
    '<button class="btn-primary" id="btn-apply-largeSize" onclick="applySettingsLargeSize()">应用</button>' +
  '</div>' +
'</div>'

// 小尺寸（结构同上，id 中 Large→Small）
```

**同步当前值到弹窗**（替换原 settingsRowsInput/ColsInput 同步块）：

```javascript
document.getElementById('settingsLargeRowsInput').value = sizeSlots.large?.rows ?? 60;
document.getElementById('settingsLargeColsInput').value = sizeSlots.large?.cols ?? 120;
document.getElementById('settingsSmallRowsInput').value = sizeSlots.small?.rows ?? 24;
document.getElementById('settingsSmallColsInput').value = sizeSlots.small?.cols ?? 80;
```

### 应用逻辑

```javascript
function applySettingsSizeFor(sizeMode) {
    const isLarge = sizeMode === 'large';
    const rInput = document.getElementById(`settings${isLarge ? 'Large' : 'Small'}RowsInput`);
    const cInput = document.getElementById(`settings${isLarge ? 'Large' : 'Small'}ColsInput`);
    const r = parseInt(rInput.value);
    const c = parseInt(cInput.value);
    if (!Number.isInteger(r) || !Number.isInteger(c)) {
        fbBtn(`btn-apply-${sizeMode}Size`, false);
        return;
    }
    // 第一步：写 sizeSlots 槽位（服务端会全量广播 size_slots）
    wsSend({ type: 'size_slots', sizeMode, rows: r, cols: c });
    // 第二步：切到目标尺寸（服务端会广播 current_size + 调 PTY）
    wsSend({ type: 'current_size', size: sizeMode });
    addFrontendLog(`${isLarge ? '大' : '小'}尺寸变更为 ${r}x${c}`);
    fbBtn(`btn-apply-${sizeMode}Size`, true);
}

function applySettingsLargeSize() { applySettingsSizeFor('large'); }
function applySettingsSmallSize() { applySettingsSizeFor('small'); }
```

### 切换按钮点击

```javascript
function toggleSize() {
    const newSize = currentSize === 'small' ? 'large' : 'small';
    const slot = sizeSlots[newSize];
    if (!slot) return;  // size_slots 消息还没到（极端情况）
    wsSend({ type: 'current_size', size: newSize });
    // 按钮文字由服务端广播 current_size 后回填，避免乐观更新与服务端不一致
}

function updateSizeToggleText() {
    const btn = document.getElementById('sizeToggleBtn');
    if (btn) btn.textContent = currentSize === 'small' ? '小' : '大';
}
```

### WebSocket 消息处理

```javascript
} else if (msg.type === 'size_slots') {
    sizeSlots = msg.data;  // 全量覆盖
    // 弹窗打开时同步：仅在 modal 已开时刷新
    const largeRows = document.getElementById('settingsLargeRowsInput');
    if (largeRows) {
        largeRows.value = sizeSlots.large.rows;
        document.getElementById('settingsLargeColsInput').value = sizeSlots.large.cols;
        document.getElementById('settingsSmallRowsInput').value = sizeSlots.small.rows;
        document.getElementById('settingsSmallColsInput').value = sizeSlots.small.cols;
    }
} else if (msg.type === 'current_size') {
    currentSize = msg.data;
    const slot = sizeSlots[currentSize];
    if (slot) {
        sessions.forEach(s => s.resize(slot.cols, slot.rows));
    }
    updateSizeToggleText();
}
```

**删除**原 `else if (msg.type === 'resize')` 分支。

## 后端逻辑

### loadConfig 改造

- `sizeSlots` 兜底：缺失/非法时填默认值
- `currentSize` 兜底：非 'large'/'small' 时填 'large'
- `sizeSlots.large/small.rows/cols` 必须在 20-200 整数范围内
- 不迁移 `rows/cols` 顶层字段（用户明确不需要兼容老用户）

### 辅助函数

```javascript
function buildSizeSlotsMsg() {
    return { type: 'size_slots', data: config.sizeSlots };
}

function resizeAllPtys(rows, cols) {
    Object.values(sessions).forEach(s => s.pty.resize(cols, rows));
}
```

### createSession 改造

- 启动 PTY 时用 `config.sizeSlots[config.currentSize].rows/cols`（替代原 `config.rows/cols`）

### wss.on('connection') 改造

- 删除原 `resize` 下发
- 新增 `size_slots(全量)` + `current_size` 下发（在 `list` 之后、`hotkeys` 之前）

### ws.on('message') 改造

新增两个分支（位置：`client_tail_max` 之后、`buffer_size` 之前）：

```javascript
else if (type === 'size_slots') {
    const sizeMode = p.sizeMode;
    if (sizeMode !== 'large' && sizeMode !== 'small') return;
    const r = parseInt(p.rows);
    const c = parseInt(p.cols);
    if (!Number.isInteger(r) || r < 20 || r > 200) return;
    if (!Number.isInteger(c) || c < 20 || c > 200) return;
    config.sizeSlots[sizeMode] = { rows: r, cols: c };
    saveConfig(config);
    broadcast(buildSizeSlotsMsg());
}
else if (type === 'current_size') {
    const size = p.size;
    if (size !== 'large' && size !== 'small') return;
    if (config.currentSize === size) return;  // 无变化则跳过
    config.currentSize = size;
    const slot = config.sizeSlots[size];
    resizeAllPtys(slot.rows, slot.cols);
    saveConfig(config);
    broadcast({ type: 'current_size', data: size });
}
```

**删除**原 `else if (type === 'resize')` 分支。

## 性能影响分析

### 前端

- **DOM 操作量**：新增 1 个 toolbar 按钮（静态）；弹窗多 2 节 HTML（约 200 字符）
- **事件监听器**：toggleSize 函数 1 个 onclick（与现有按钮一致）
- **布局/回流**：toolbar 现 7 按钮 + wsStatus，`flex-wrap: wrap` 仍生效
- **内存开销**：每客户端新增 sizeSlots 引用（2 个对象）+ currentSize 字符串
- **执行频率**：toggleSize 仅在点击时触发（无定时器）
- **网络开销**：每次应用按钮点击 = 2 条消息（约 150 字节）

### 后端

- **进程操作**：`resizeAllPtys` 在切尺寸时调用，等于现有 resize 行为
- **内存**：config 多 1 个 sizeSlots 对象（4 个数字）
- **执行频率**：`size_slots` 仅在用户点"应用"时触发；`current_size` 仅在切换时触发
- **网络广播**：`size_slots` 全量广播 payload 约 100 字节；`current_size` 约 50 字节
- **落盘频率**：每个 size_slots / current_size 消息都触发 saveConfig（与现有 scroll_interval / max_buffer 一致；项目已接受"无防抖"原则，见 AGENTS.md 注意事项 9）

## 测试清单

| # | 场景 | 步骤 | 预期 |
|---|------|------|------|
| 1 | 首启（无 config.json） | 删除 config.json，npm start | sizeSlots=大60×120/小24×80, currentSize=large, 终端 60×120, 按钮"大" |
| 2 | 首连 size_slots/current_size 下发 | 浏览器打开 | console 看到 size_slots+current_size 两条消息，xterm 尺寸正确 |
| 3 | 切换按钮：大→小 | 点 #sizeToggleBtn | 终端立即变 24×80, 按钮变"小", config.currentSize="small", 所有 PTY 被 resize |
| 4 | 切换按钮：小→大 | 再次点 | 终端立即变 60×120, 按钮变"大" |
| 5 | 设置弹窗改大尺寸 | 改行 80，列 200，点"应用" | 终端变 80×200, 按钮"大", config.sizeSlots.large={80,200}, config.currentSize="large" |
| 6 | 设置弹窗改小尺寸（当前为大） | 改行 30，列 100，点"应用" | 终端变 30×100, 按钮"小", config.sizeSlots.small={30,100}, config.currentSize="small" |
| 7 | 新建会话 | 点"新建终端" | 新 PTY 用 sizeSlots[currentSize].rows/cols 启动 |
| 8 | 关闭所有终端 | 点"关闭终端"到 0 | 自动创建一个（用当前 sizeSlots[currentSize]） |
| 9 | 多客户端同步 current_size | A 切小，B 监听 | B 收到 current_size="small"，B 终端变 24×80 |
| 10 | 多客户端同步 size_slots | A 改大尺寸"应用"，B 监听 | B 收到 size_slots 全量，B 弹窗打开时刷新输入框 |
| 11 | 重连 | F5 刷新 | size_slots(全量) + current_size 立即下发，终端恢复正确尺寸 |
| 12 | current_size 无变化 | 已经是大，再发 current_size="large" | 服务端跳过 broadcast |
| 13 | 非法值 | size_slots rows=999 | 服务端拒收 |
| 14 | 弹窗打开时外部改 size_slots | A 改大尺寸，B 弹窗打开中 | B 弹窗的 4 个 input 同步刷新 |
| 15 | 按钮文字的更新时机 | 切换瞬间 | 不做乐观更新，等服务端 broadcast current_size 后回填 |
| 16 | 行/列 20-200 范围 | 改 19 或 201 | 弹窗 input min/max 拦截，服务端也兜底拦截 |
| 17 | TermSession 构造时无 sizeSlots | list 处理器先创建 TermSession 再收到 size_slots | xterm 默认 80×24 短暂闪现，current_size 到达后立即 resize |
| 18 | 老的 resize 消息 | F12 手动发 `{type: 'resize', id: 0, data: {rows: 100, cols: 100}}` | 服务端无处理分支（被忽略） |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| TermSession 构造时 sizeSlots 未到位 | xterm 默认尺寸（80×24）闪现后被 resize 覆盖 | 体验短暂；list 处理器先发 size_slots 再 current_size，顺序有保障 |
| 应用按钮发两条消息中途断开 | size_slots 落盘但 current_size 没发 | 重连后服务端用最新 sizeSlots + currentSize 重建状态，无一致性问题 |
| 多个客户端同时改 | 最后写入者胜出 | 已接受"无锁"原则（与现有 hotkeys / scrollInterval 并发模型一致） |
| 切换按钮被点得太快 | currentSize 频繁变化 + saveConfig 反复落盘 | 落盘走异步 fs.writeFileSync，PTY resize 是同步阻塞，频率低无影响 |
| syncLayoutWidths 与 xterm cols 变化 | xterm 变宽后 toolbar/hotkeys-bar 跟随 | ResizeObserver 已监听 terminal-container 宽度变化，自动同步刷新宽度 |

## 与现有功能的关系

- **`addFrontendLog`**：切换 / 设置时打日志，与现有 resize 行为一致
- **`syncLayoutWidths`**：依赖 `#terminal-container` 宽度，xterm cols 变化后触发 ResizeObserver → toolbar/hotkeys-bar 同步刷新宽度
- **`TermSession.resize(cols, rows)`**：方法保留，内部仍调 `this.term.resize(cols, rows)`
- **`rename` / `rename_all`**：不受影响
- **`buffer_size` 查询**：不受影响
- **PM2 重启**：不受影响（重启后从 config 读 sizeSlots + currentSize）
- **`restart_server`**：前端 ws.onclose 触发 1 秒后重连，size_slots+current_size 重新下发，xterm 重建
- **TermSession 构造顺序**：list → 创建 TermSession → size_slots(全量) → current_size → 调整所有 xterm。第一批 xterm 构造时无 sizeSlots，依赖 current_size 到达后批量 resize

## 不在范围

- 大/小尺寸之外的其他预设（如"中等"）
- 键盘快捷键切换尺寸
- 切换动画 / 过渡效果
- 大/小尺寸命名自定义
- 老 config.json 的 `rows/cols` 字段迁移（用户明确不需要）

## 回退方案

保留本次改动的 git commit。必要时 `git revert HEAD` 即可恢复。

回退时需手动删除本地 config.json 中的 `sizeSlots` / `currentSize` 字段（否则下次启动会保留这两个字段但代码不再使用，无害但冗余）。
