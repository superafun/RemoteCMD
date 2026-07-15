# 最近路径库（Recent Paths）功能设计

- 日期：2026-07-15
- 状态：已批准，待实现
- 范围：前端 `public/index.html` + 后端 `server.js`，新增「最近路径」记录与展示功能，并把「关闭终端」按钮移入设置面板。

## 1. 背景与目标

用户在发送命令时经常输入本地文件夹路径（如 `C:\Users\fmy3`）。希望系统自动记录这些路径，提供一个「最近路径」入口，点击即可复制，避免重复手敲。

核心要求：
- 每次发送时检测是否包含本地文件路径，有则入库。
- 路径库：不重复，最多保留 10 条。
- 排序：每次新检测到的路径置顶（第一位）。
- 顶部新增「最近路径」按钮，展开小弹窗展示最近 10 条。
- 弹窗里点击某条路径即复制到剪贴板。

## 2. 同步与持久化策略

用户明确要求：与设置项同款机制——值写入 `config.json`，走 WebSocket 多端同步，重启服务器不丢失。因此**不**使用 localStorage / 纯内存变量，而是走 `config.json` + WS 链路（与 `feedback_all_settings_multi_client_sync` 同款，即使该项不出现在设置弹窗里）。

## 3. 数据模型（config.json）

新增字段：

```json
"recentPaths": []
```

- 类型：`string[]`，每项为一个 Windows 盘符绝对路径。
- 约束：长度 ≤ 10、元素不重复、顺序为「新→旧」（index 0 最新）。
- `loadConfig` 增加默认值兜底 `recentPaths: []`（纯安全网，不做老用户迁移）。
- 服务端对入站 `recent_paths_add` 的 path 做校验：必须是非空字符串；非法 payload 直接丢弃，不写盘。

## 4. 路径识别（前端，发送时）

位置：`public/index.html` 的 `sendInputBar()`（约 L1396），在真正 `wsSend` 发送前插入检测。

- 正则：`/\b[A-Za-z]:\\[^\s"'`]+/`
- 范围：仅识别 Windows 盘符绝对路径（`C:\…`、`D:\…`）；不识别 UNC、不剥引号、不识别相对路径。
- 一次发送只取**第一条**匹配路径。
- 命中则 `wsSend({ type: 'recent_paths_add', path })`；未命中（纯命令、无路径）不发送。

## 5. WebSocket 协议

- 上行（前端→服务端）：`{ type: 'recent_paths_add', path: string }` —— 发送时检测到路径后发送单条增量。
- 下行（服务端→所有客户端）：`{ type: 'recent_paths', list: string[] }` —— 服务端更新后广播完整列表。
- 与设置项一致：前端只负责 `wsSend` 上行，本地状态由接收侧 `recent_paths` 消息更新。

## 6. 服务端处理（server.js）

- 新增 `recent_paths_add` 消息分支：
  1. 校验 path 合法；
  2. 若已存在则从数组移除（去重）；
  3. `unshift` 到数组最前（置顶）；
  4. 截断到 10 条：`recentPaths = recentPaths.slice(0, 10)`；
  5. 写回 `config.json`（复用现有写盘逻辑）；
  6. 向所有连接广播 `{ type: 'recent_paths', list: recentPaths }`。
- 新连接建立时，在现有「下发设置」逻辑里把 `recentPaths` 一并下发（保证刷新/重连后列表立即可见）。
- 现有的 `kill` 处理（约 L227，`sessions[id].pty.kill()`）**不动**。
- 多端同时发送：以服务端数组为准，先到先置顶，广播保证各端一致。

## 7. UI 改动

### 7.1 顶部工具栏（public/index.html `.toolbar`，约 L40–L50）

- **移除** L45 的「关闭终端」按钮：`<button onclick="killCurrent()">关闭终端</button>`。
- 在该位置（紧邻「设置」按钮前）新增「最近路径」按钮 `#recentPathsBtn`，点击展开/收起下拉弹窗。

### 7.2 「关闭终端」移入设置面板

- 设置弹窗 `openSettingsModal()`（约 L162–L336）末尾 `modal-actions`（约 L331）附近，新增一个「会话控制」分组或直接并入 actions，放：
  ```html
  <button class="btn-danger" onclick="killCurrent()">关闭当前终端</button>
  ```
- 复用现有 `killCurrent()`（约 L1072），后端逻辑不变。`.btn-danger` 与现有「重启服务器」按钮风格一致。

### 7.3 「最近路径」下拉弹窗

- 复用现有 `#sessionDropdown` 的下拉模板与定位/关闭逻辑（`getBoundingClientRect` 定位 + `classList.toggle('open')` + 外部点击关闭，约 L1050–L1066）。
- 弹窗内逐条渲染 `recentPaths`：
  - 每条是**一个可点击整行**，点击整行 = 复制到剪贴板。
  - 点击 → 调用现有 `copyToClipboard(text)`（约 L1119）+ `showToast('已复制', 'success')`（约 L1103）。
  - **不含**独立「复制」按钮；**不含**点击文字插入输入条功能（按用户简化要求）。
- 弹窗宽度**紧凑**、按路径内容贴合，无多余横向留白（遵循 feedback_compact_ui_no_whitespace）；手机端保留 `width:min(Xpx, calc(100vw - 24px))` 收缩避免溢出。
- 空状态：列表为空时显示一行「暂无记录」。
- 点击按钮或弹窗外部自动收起。

## 8. 边界与错误处理

- 一次发送只取首个匹配路径；多个路径（`copy C:\a D:\b`）只记录第一条。
- 空输入、纯命令无路径：不触发任何 WS 消息。
- 服务端校验非法 payload（类型错、超长、非字符串）直接丢弃，不写盘、不广播。
- 路径识别正则不含引号/空格-stop 字符，带空格路径需用户自行用引号包裹时不会被整段吞入（按「仅盘符绝对路径」决策，不剥引号）。

## 9. 测试

- 前端功能：
  - 发送 `cd C:\Users\fmy3` → 弹窗出现该路径且置顶。
  - 发送 `copy D:\a E:\b` → 只记录第一条 `D:\a`。
  - 发送无路径命令（如 `ls`）→ 不记录。
  - 再次发送已存在路径 → 该路径移到最前、不产生重复。
  - 累计超过 10 条 → 只保留最新 10 条（最旧被丢弃）。
  - 点击路径 → 剪贴板内容为该路径 + Toast「已复制」。
- 多端同步：
  - A 端发送后，B 端「最近路径」弹窗即时出现该路径。
  - 刷新页面 / 重启服务器后，列表仍在（来自 config.json）。
- 「关闭当前终端」按钮（设置面板）点击 → 关闭当前终端，效果与原工具栏按钮一致。

## 10. 不在范围内（YAGNI）

- 不识别 UNC 路径、不带引号剥离。
- 不做点击路径插入输入条。
- 不做路径库的手动删除/清空 UI（如需后续再加）。
- 不做按终端 session 分别记录（全局共享一份）。
