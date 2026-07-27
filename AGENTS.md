# Remote PowerShell Terminal Agent Guide

基于 Web 的远程 PowerShell 终端应用。浏览器连接到服务器后获得一个或多个 PowerShell 终端会话，支持多会话切换、快捷键自定义、终端尺寸调整。

## 构建 / 运行 / 依赖

```bash
# 安装依赖（node-pty 需要原生构建工具 —— Visual Studio Build Tools 或类似工具）
npm install

# 安装 PM2 进程管理器（一次性操作）
npm install -g pm2

# 启动服务器（http://localhost:65433），PM2 会自动守护进程
npm start
```

- **无测试框架**、**无 linter**、**无 formatter** 配置。
- `package.json` 中的 `test` 脚本是占位符（`echo "Error: no test specified" && exit 1`）。
- **不是 git 仓库** —— 无版本控制。
- `@xterm/addon-fit` 在 `package.json` 中但**前端并未实际使用**（未使用的依赖）。

## 架构

### 数据流

```
Browser (index.html)
  │  WebSocket ws://host:65433/cmd/
  │  JSON 消息（见下方协议）
  ▼
server.js
  ├── express.static → 托管 public/, @xterm/xterm, addon-* (端口 65433)
  └── WebSocketServer → 通过 node-pty 创建/销毁 PowerShell 会话
        │
        ▼
      powershell.exe（每个会话一个进程）
```

### 组件映射

| 模块 | 文件 | 行数 | 职责 |
|--------|------|-------|---------------|
| 后端 | `server.js` | 100 | Express 静态服务器 + WebSocket 处理器 + node-pty 会话生命周期 + PM2 重启 |
| 前端 | `public/index.html` | 320 | 单页应用：xterm.js v6 终端、会话切换器、快捷键编辑器、滚动控制、自动重连、重启服务器 |
| 配置 | `config.json` | ~21 | 持久化配置：`rows`、`cols`、`hotkeys`（名称→转义序列）、`scrollIntervalTerminal`、`scrollIntervalPage`、`screenHistoryLines`（重连滚屏历史行数，默认 1000）、`maxFrontendLogs` |

### WebSocket 协议（JSON，type 字段）

## 登录认证（2026-07-27 引入）

- 认证 authority 已归 `server.js`；nginx `/cmd/` 块仅保留 TLS 反代，不再有 `auth_basic`。
- 会话 = 无状态签名 cookie `rc_session` = `<到期时间戳ms>.<HMAC-SHA256(sessionSecret, 时间戳)>`；`HttpOnly` + `SameSite=Lax` + `secure:'auto'`（走 nginx HTTPS 自动加 Secure，直连 localhost 不加）。
- 密码**复用 nginx 的 htpasswd 文件**（`config.htpasswdPath`，默认 nginx conf 下 `htpasswd`），每次登录实时读取校验；支持 `{SHA}`（当前格式）/ `{PLAIN}` / 明文 / `$apr1$`。`sessionSecret` 存 `config.json`（缺失自动生成）。
- 每次 HTTP 请求与每次 WebSocket 升级（含重连）都验 cookie，过期 → HTTP 401 / WS 拒绝升级 → 前端跳 `/login`。
- 端点：`POST /api/login`、`POST /api/logout`、`GET /api/auth-check`；`GET /login` 发登录页；未登录访问任何非白名单路径 → 302 到登录页。
- 前端全用相对 URL；`X-Forwarded-Prefix` 用于在 nginx 前缀（`/cmd/`）下生成正确跳转地址。
- 「保持登录时长」为普通设置项（`sessionDurationMin`，默认 1440，范围 1–20160），连接时下发 + 可改 + 多端同步；影响**下次登录**的 cookie 有效期（已登录会话在登录时即固定，需重连/重登才按新值）。

**服务端 → 客户端：**

| type | 说明 |
|------|-------------|
| `list` | 当前会话 ID 列表（连接时及会话变更后发送） |
| `data` | 指定会话的终端输出（id + data） |
| `buffer` | 重连/切会话屏幕同步响应（id + data + reset）。`data === ''` = 指纹命中未变更（客户端跳过）；`data` 为 ANSI 且 `reset: true` = 整屏序列化重建（客户端 `term.reset() + term.write(data)`，含可见视口 + 有界真实滚屏历史） |
| `size_slots` | 大/小尺寸槽位全量广播（data: {large: {rows, cols}, small: {rows, cols}}），连接建立时下发 + 客户端写槽后广播 |
| `current_size` | 当前尺寸广播（data: 'large' \| 'small'），连接建立时下发 + 客户端切换后广播 |
| `hotkeys` | 快捷键配置同步 |
| `scroll_interval_terminal` | 终端按住滚动间隔（单位：ms） |
| `scroll_interval_page` | 页面按住滚动间隔（单位：ms） |
| `max_frontend_logs` | 前端日志上限值（单位：条） |
| `session_duration_min` | 保持登录时长（单位：分钟，范围 1–20160） |
| `input_bar_button_action` | 输入条右侧按钮动作（data: 'newline' \| 'send'），连接建立时下发 + 设置变更时广播 |
| `input_bar_enter_action` | 输入条 Enter 键动作（data: 'newline' \| 'send'），连接建立时下发 + 设置变更时广播 |
| `input_bar_close_after_send` | 发送后关闭输入条（data: boolean），连接建立时下发 + 设置变更时广播 |
| `enter_delay_ms` | 回车停顿时长（单位：ms），连接建立时下发 + 设置变更时广播 |
| `restart_server` | 服务端重启确认（data: 'ok'） |

**客户端 → 服务端：**

| type | 说明 |
|------|-------------|
| `create` | 创建新会话 |
| `input` | 向会话写入数据（id + data） |
| `kill` | 关闭会话（id） |
| `buffer` | 请求会话屏幕同步（id + screenHash）。screenHash 是客户端当前可见视口指纹（FNV-1a over `translateToString()`），服务端比对自身 headless 视口 hash（见注意事项 20） |
| `size_slots` | 写大/小尺寸槽位（sizeMode: 'large'\|'small' + rows + cols），服务端会写槽 + 落盘 + 全量广播 |
| `current_size` | 切换当前尺寸（size: 'large'\|'small'），服务端会切换 + 调所有 PTY + 落盘 + 广播 |
| `hot_keys` | 更新快捷键配置（data） |
| `scroll_interval_terminal` | 更新终端按住滚动间隔（data，单位：ms） |
| `scroll_interval_page` | 更新页面按住滚动间隔（data，单位：ms） |
| `max_frontend_logs` | 更新前端日志上限（单位：条） |
| `session_duration_min` | 更新保持登录时长（data，单位：分钟，1–20160） |
| `input_bar_button_action` | 更新输入条右侧按钮动作（data: 'newline' \| 'send'） |
| `input_bar_enter_action` | 更新输入条 Enter 键动作（data: 'newline' \| 'send'） |
| `input_bar_close_after_send` | 更新发送后关闭输入条（data: boolean） |
| `enter_delay_ms` | 更新回车停顿时长（data，单位：ms，50–3000） |
| `restart_server` | 触发服务端重启（PM2 自动重启） |

### 会话生命周期

- 每个会话 = `sessions{}`（内存映射）中的 `{ pty: IPtyProcess, screen: HeadlessTerminal, serializeAddon: SerializeAddon, _writeSeq }`。`screen` 是 `@xterm/headless` 终端（scrollback = `config.screenHistoryLines`，默认 1000），加载 `Unicode11Addon`（`activeVersion='11'`）与 `SerializeAddon`；PTY `onData` 经 `sess._writeSeq` promise 链串行喂入（每次 `scr.write(d, res)`，确保序列化前流已排空），**不再保留原始字节 buffer**。
- 进程退出时，删除该会话并向所有客户端广播 `list`。
- 首次 WebSocket 连接时若没有会话，自动创建一个。
- 后端使用数字 ID 跟踪会话（`sessionCounter++`）。

## 关键文件

| 路径 | 角色 |
|------|------|
| `server.js` | **整个后端** —— Express 5、WebSocket（/cmd/）、node-pty 创建子进程 |
| `public/index.html` | **整个前端** —— 内联 JS、xterm.js v6、无打包工具 |
| `config.json` | 运行时持久化配置（rows、cols、hotkeys、scrollIntervalTerminal、scrollIntervalPage、screenHistoryLines、maxFrontendLogs） |
| `package.json` | 依赖：express ^5、ws ^8、node-pty ^1、@xterm/xterm ^6、3 个 addon；scripts：start/restart/stop（PM2） |
| `reasonix.toml` | CodeWhale IDE 配置（非项目运行时配置） |

## 前端关键辅助函数（public/index.html）

- **`wsSend(obj)`** —— 所有 WebSocket 发送的统一入口。内置 `readyState === 1` 状态检查 + try-catch，断连时静默失败不抛异常。**所有 `ws.send()` 必须走此函数，禁止直接调用 `ws.send()`。**
- **`sendInput(data)`** —— `wsSend({type:'input', id:activeId, data})` 的封装。所有键盘/滚动输入都必须通过此函数。
- **`parseHotkey(name)`** —— 将快捷键名称（`Ctrl+C`、`↑`、`Tab`）解析为转义序列。使用查找映射 + `Ctrl+X → \x03` 公式。
- **`createTermInstance(id)`** —— 创建新的 xterm.js Terminal + DOM 包装器，加载 WebLinksAddon + Unicode11Addon，请求缓冲区回放。
- **`switchSession(id)`** —— 隐藏当前终端包装器，显示目标终端，更新下拉框。
- **`renderHotkeys()`** —— 从 `hotkeys` 映射渲染快捷键按钮。
- **`openHotkeyEditor()`** —— 用于添加、删除、重新排序快捷键的模态弹窗。
- **`syncHotkeys()`** —— 发送 `{type:'hot_keys', data:hotkeys}` 到服务端。
- **`toggleSize()`** —— 顶栏大/小尺寸切换按钮。发 `{type:'current_size', size:'large'|'small'}` 到服务端。按钮文字由服务端 broadcast `current_size` 后由 `updateSizeToggleText()` 回填。
- **`applySettingsSizeFor(sizeMode)`** —— 设置弹窗大/小尺寸"应用"按钮。发两条消息：先 `size_slots`(sizeMode, rows, cols) 写槽，再 `current_size`(size: sizeMode) 切尺寸。
- **`updateSizeToggleText()`** —— 收到 `current_size` 时更新顶栏按钮文字（大/小）。

## 编码约定

- **一切单文件** —— 后端一个文件（server.js），前端一个内联 JS 的 HTML 文件。
- **无中间抽象层** —— 无路由/中间件拆分，无打包工具，无构建步骤。
- **纯 JS + CommonJS** —— `require()`、`module.exports`（服务端），无 TypeScript。
- **极简主义** —— 每个功能都以最简单的代码路径实现。不做过早的泛化。
- **配置模式** —— 启动时读取，变更时同步写入。`JSON.parse` / `JSON.stringify` 往返。

## Git 工作流

**2026-06-30 起项目纳入 git 版本控制**。单人本地开发，单 `main` 分支。

### 追踪范围

- **追踪**：`server.js` / `public/index.html` / `public/term-session.js` / `public/styles.css` / `package.json` / `package-lock.json` / `docs/` / `AGENTS.md`
- **不追踪**（详见 `.gitignore`）：`node_modules/` / `.pm2/` / `config.json` / `reasonix.toml` / IDE 与 OS 临时文件 / `*.log`
- xterm 静态资源由 `node_modules/@xterm/xterm` 提供（`server.js` 用 `express.static` 挂到 `/xterm`），无需 vendored 副本

### 提交信息规范

`<前缀>: <一句话描述>`（Conventional Commits 风格，中英文皆可）：

- `feat:` — 新功能
- `fix:` — Bug 修复
- `refactor:` — 重构（无功能变化）
- `docs:` — 文档 / AGENTS.md 变更
- `chore:` — 工具 / 构建 / 依赖更新

### Commit / 回退

- **每次代码修改完成后必须立即 git commit**，不允许累积多个改动后再一次性提交。
- 一个独立变更一个 commit；阶段性进展先 commit 再继续。
- commit 前 `git status` 确认要 add 的文件，**禁止** `git add -A`（会带进临时文件）。
- 单步回退：`git revert HEAD`；多步：`git revert <sha1>..<sha2>`。
- **禁止** `git reset --hard` 撤销已超过 1 个 commit 的历史。
- git 管代码版本，PM2 管进程生命周期，两者正交。**禁止**用 git 命令误杀 PM2 进程。

## 已知注意事项

1. **⚠️ 按钮 `line-height` 中英文差异** —— 2026-07-01 修复。通用 `button` 样式缺少 `line-height`，浏览器 `line-height: normal` 对纯英文文本（如"Shell #1"）与含中文文本（如"新建终端"）计算值不同（英文~1.15、中文~1.5），导致按钮高度不一致。修复方式：通用 `button` 规则添加 `line-height: 1.4` 固定行高，所有按钮高度不再受文字语言影响。同步修复了 `.dropdown-menu button` 中 `border: none; background: none;` 导致的 dropdown 按钮额外矮 2px 的问题。

3. **`@xterm/addon-fit` 未使用** —— 在 package.json 中但从未在 index.html 中加载或实例化。可安全移除。
4. **重连屏幕同步上限由 `config.json` 的 `screenHistoryLines` 控制**（默认 1000，范围 0–20000），即 headless 终端保留的真实滚屏历史行数，重连后客户端可上滚查看。设置弹窗内输入并实时同步所有客户端（`screen_history_lines` 消息）。旧 `maxBuffer`/`clientTailMax`/`syncMode` 字段已在 `loadConfig` 中删除。
5. **客户端→服务端的 hotkey type 是 `hot_keys`**（下划线），不是 `set_hotkeys` 或 `hotkeys` —— 字符串必须精确匹配。
6. **端口 65433 是硬编码的** —— 无环境变量或 CLI 覆盖方式。
7. **无认证/加密** —— 用于受信任网络边界内的本地/LAN 使用。
8. **`node-pty` 需要原生构建工具** —— 在 Windows 上可能需要 Visual Studio Build Tools 或 `windows-build-tools` npm 包。
9. **每次变更配置都会立即持久化** —— 无防抖处理。快速连续调整大小时每次都会同步写入磁盘。
10. **`package.json` 中需要 `allowScripts`** 以支持 `node-pty` 原生绑定（已设置）。
11. **多客户端创建终端隔离**：前端 `pendingCreate` 标志位识别"刚才那个 create 请求是不是本客户端发起的"。`createNew()` 置 true，`createTermInstance()` 末尾若为 true 则消费并 `switchSession`，WS 断连时 `onclose` 复位。**新 wrapper 创建后默认 `display: none`**（[public/index.html L156](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L156)）：创建者由 `switchSession` 翻成 `block`；旁观者保持 `none`，新终端在 DOM 中存在（下拉框可选）但视觉上不叠加在旧终端下。
12. **删除当前终端后跳到 ID 最大者**：list 处理器中 `if (!activeId && currentIds.length > 0)` 分支使用 `currentIds.reduce((a, b) => +a > +b ? a : b)` 选取目标，跳到最新创建的会话（而非下拉框第一个）。`reduce` 对单元素数组直接返回该元素，结合 `length > 0` 守卫确保空数组不会触发。非当前会话被 kill 不触发跳转。
13. **重连后 buffer 增量拉取**：list 处理器中 `isFirstList` 标志位在 `ws.onopen` 中重置为 true。重连后第一个 list 到达时，对 `oldTermIds ∩ currentIds`（即双方都有的 term）发 `{type:'buffer'}` 请求，断网期间的内容用 `term.reset() + term.write()` 补回。常规 session create / kill 的 list 不会进入该分支，避免误刷旧 term 导致闪烁。`createTermInstance` 内既有的 buffer 请求保留（按职责对称：新建 xterm 立刻拉 buffer 填满）。
14. **前端布局**：页面宽度由 `#terminal-container`（xterm）决定。CSS 层面 `.toolbar` 和 `#hotkeys-bar` 用 `flex-wrap: wrap`。`.toolbar button` 和 `#hotkeys-bar button` 统一 `min-width: 60px`，防止「编辑」「▲」等短文字按钮被 flex 压缩到看不清（弹窗内的 button 不受此约束，由 `.modal-box button` 单独控制）。**连接状态**：`#wsStatus` 紧跟在「设置」按钮后面（DOM 顺序），`margin-left: 4px` 与按钮隔开，作为 flex 子元素参与自动换行。**JS 同步**：`syncLayoutWidths()` 函数读取 `terminal-container.offsetWidth`，把 `.toolbar` 和 `#hotkeys-bar` 的 `style.width` 设为该值，触发点在 `DOMContentLoaded`（首屏同步）和 `ResizeObserver(terminal-container)`（xterm 尺寸变化同步）。**注意**：原本还有 `window resize` 触发点，但 `#terminal-container { align-self: flex-start }` 不随窗口缩放变化，`window resize` 永远无效，已于 2026-06-30 删除。原因：纯 CSS 的 `width: max-content` 在 flex column 容器中会取所有子元素的最大宽度（hotkeys 按钮过多会撑开页面），用 JS 显式同步更可靠。`html { overflow-x: auto }` 是兜底（xterm 本身比视口宽时出现水平滚动条）。
15. **设置弹窗**：顶栏「设置」按钮打开。包含终端大小、终端滚动行数、按住滚动间隔(ms)、缓冲区上限(MB)、日志上限(条) 5 个可配置块，加上缓冲区占用（只读、自动检测）一块。复用现有 `.modal-overlay / .modal-box` 样式。`settingsDiv` 是全局 DOM 句柄（与 `editorDiv` 对称）。
16. ~~buffer 自动检测~~（已移除，2026-07-21）：原“缓冲区占用”自动检测依赖 `buffer_size` 消息与 `queryBufferSize()`，随 legacy 字节流机制一并删除；设置弹窗不再有该只读块。
17. **2026-06-30 过度设计审查结论**：发现 3 处过度设计 / 冗余，**均已修复**：
    1. `public/index.html` 中 3 个 hidden input（`rowsInput/colsInput/scrollStepInput`）用 DOM 当 state 容器 → 改为 JS 顶层变量（`let rows = null, cols = null`；`scrollStep` 原本就同时是 JS 变量，删除 DOM 那份）。`createTermInstance` 用 `Number.isInteger(rows) && Number.isInteger(cols)` 守卫跳过初始 resize（与旧版 hidden input 空 value 行为一致）。
    2. `syncLayoutWidths` 函数 4 个触发点中 `window resize` 是冗余（`#terminal-container { align-self: flex-start }` 不随窗口缩放变化） → 删除 `window.resize` 监听，保留 `DOMContentLoaded` + `ResizeObserver` 两个有效触发点。
    3. `updateWsStatus` 1Hz 轮询 → 改事件驱动。`ws.onopen / onerror / onclose` 三事件触发 `updateWsStatus()`。**重连策略**：
       - `ws.onclose` 内检查 `navigator.onLine`：在线则 `setTimeout(connect, 1000)` 延迟重试；离线则不安排定时器，等 `online` 事件
       - `window.addEventListener('online', connect)`：浏览器报告网络恢复时立即重连
       - `reconnectTimer` 变量 + `clearTimeout`：`connect()` 开头清理上一个待执行的重连定时器
       - **用户测试发现并修复（2026-06-30）**：最初 `connect()` 函数开头有 `if (!navigator.onLine) return` 守卫，导致 `onclose` 设置的定时器在 1 秒后触发时若仍离线就直接 return 且不安排后续重试，形成"悬空"状态。修复方式：将 `navigator.onLine` 判断从 `connect()` 移到 `ws.onclose` 中，由 `onclose` 决定是安排 backoff 还是等待 `online` 事件，`connect()` 只负责建立连接。
    - **已知风险**：移动端"沉默死亡"（TCP 连接被 NAT 清掉但浏览器不感知）场景下，UI 显示"已连接"但实际断了。**当前能覆盖**：飞行模式/无 WiFi 等明确离线状态（`navigator.onLine` 变 false → 不重试；`online` 事件触发 → 立即重连）。**仍覆盖不到**：网络活着但 WS 连接被中间设备单方面清掉。遇到此情况手动 F5 刷新。
    
    其他 8 个候选点（`min-width: 60px` 移动端点击区域、`availableKeys` 手机点选、`computeSmartName` 命名连贯、70 行 `.modal-box` CSS、3 个独立"应用"按钮等）经用户确认均为合理设计或可选优化，**不在本次范围**。完整审查记录见 [docs/superpowers/specs/2026-06-30-over-engineering-audit-design.md](docs/superpowers/specs/2026-06-30-over-engineering-audit-design.md)。**新增/修改代码时如果引入新的 state 容器，优先用 JS 变量**，不再用 hidden input。

18. **滚动行数分离（2026-07-01 已移除 scrollStep）**：2026-06-30 引入 scrollStep 控制 ▲上滑终端/▼下滑终端的 SGR 滚轮事件发送次数。2026-07-01 完全移除 scrollStep，所有滚动按钮统一固定每次 1 行 + 按住滚动模式，设置弹窗中不再有"终端滚动行数"输入项。config.json 中的 scrollStep 字段已删除。

19. **PM2 进程管理 + 前端重启**：2026-06-30 引入。服务器由 PM2 管理（`pm2 start server.js --name remote-cmd`），`npm start` 启动。前端设置弹窗新增「重启服务器」按钮（`restartServer()`），发送 `{type:'restart_server'}` 到服务端。服务端回复确认后杀掉所有 PowerShell 子进程，200ms 后 `process.exit(1)` 退出，PM2 检测到非零退出码自动重启新实例。前端 `ws.onclose` 触发 1 秒后自动重连。**PM2 安装**：`npm install -g pm2`（一次性）。**常用命令**：`npm start`（启动）、`npm run restart`（重启）、`npm run stop`（停止）。**Trae 环境例外（2026-06-30）**：Trae PowerShell 工具下 PM2 daemon 反复 EPERM（Windows 命名管道权限），PM2 不可用。`server.js` 实际由独立的 node 守护进程（PID 101804）拉起，113036 是当前 remote-cmd 服务进程。`process.exit(1)` 后 101804 会自动重新 spawn 新的 server.js 实例，前端 ws.onclose 触发 1 秒后自动重连。**恢复 PM2 管理**：需在 Trae 外的 PowerShell 手动执行 `pm2 start server.js --name remote-cmd` + `pm2 save`，或在 `c:\Users\fmy3\.pm2` 不存在的全新环境下使用。

20. **重连屏幕同步：服务端 headless 整屏序列化（2026-07-18 设计 + 2026-07-21 彻底移除 legacy 字节流兜底）**：解决 TUI 屏幕是二维网格、而旧“字节流 tail 比对”把屏幕建模成一维字节流导致重连只匹配动画增量/全量回放乱码的问题。设计要点：
    - **服务端 headless 终端**：每个会话一个 `@xterm/headless` 终端（scrollback = `config.screenHistoryLines`，默认 1000），加载 `Unicode11Addon`（`activeVersion='11'`，保证字符宽度/换行对齐）与 `SerializeAddon`。PTY `onData` 经 `sess._writeSeq` promise 链串行喂入（`scr.write(d, res)` 写回调串起），序列化前 `await` 排空，避免拍到半更新屏幕（xterm `write()` 是异步的，解析发生在写回调之后）。
    - **指纹比对**：`serverViewportHash(screen)` 与客户端 `computeViewportHash(term)` 同为对可见行 `translateToString()` 做 FNV-1a，口径一致（两边均加载 Unicode11Addon）。
    - **buffer 请求带 `screenHash`**：所有 buffer 请求（新建会话 `createTermInstance` 内的 `requestBuffer()`、`isFirstList` 重连交集分支）都通过 `session.requestBuffer()` 发出，自动带当前可见视口指纹。
    - **服务端两档响应**（`buffer` 消息处理器，仅 screen 模式）：
      1. **未变更**：`serverViewportHash === screenHash` 命中 → 回 `{type:'buffer', id, data:''}`。客户端跳过 reset + write，保持原样。
      2. **整屏重建**：hash 不同 → 回 `{type:'buffer', id, data: serializeAddon.serialize(), reset: true}`（含可见视口 + 真实 scrollback ANSI）。客户端 `term.reset() + term.write(data)`，重连后既能看到完整当前屏、又能上滚看真实历史。
    - **`session.pendingBuffer: boolean` 实例字段**：客户端 `requestBuffer()` 时置 true，`handleBufferResponse()` 内置 false。**等待期间到达的 data 消息直接丢弃**（`if (s.pendingBuffer) return`），避免 buffer 响应已包含的内容重复写入（TCP 有序保证后续 data 在 buffer 响应之后到达）。
    - **`screen_history_lines` 消息**：连接建立时下发 + 设置变更时广播。服务端更新 `config.screenHistoryLines` 并 resize headless（`screen.resize`）。
    - **配置字段**：`config.json.screenHistoryLines`（默认 1000，范围 0–20000）。**旧 `clientTailMax`/`maxBuffer`/`syncMode` 字段及 `client_tail_max`/`max_buffer`/`buffer_size` 消息已全部移除**（`loadConfig` 中 `delete` 兜底）。
    - **list 处理器新建会话时调 `requestBuffer()`**：screenHash 为空 → 服务端 hash 不同 → 整屏序列化（空屏）重建，xterm 本身空、无内容可恢复。
    - **list 处理器删除 term 时清理**：`s.dispose(); sessions.delete(id)`（`TermSession.dispose()` 内 `term.dispose(); wrapper.remove(); screen.dispose();`，`_writeSeq` 随 Map GC 清理）。
    - **Phase 2（逐行 diff 增量）未做**：客户端上传整屏行数组、服务端逐行 diff 只回变更行（变更过多降级整屏）。属性能优化，非正确性必需。

21. **`computeSmartName()` 永不返回 null（2026-07-01 修改）**：修复日志中出现 `(null)` 的问题。
    - **原逻辑**：第一个会话返回 `null`，让前端用 ID 兜底显示；重连时服务端下发 `names: {"0": null}` 覆盖前端已有名称，导致日志显示 `null`。
    - **新逻辑**：
      1. 无会话 → 返回 `'Shell #1'`
      2. 有会话 → 遍历所有会话找匹配 `/^Shell #(\d+)$/` 的最大数字 N → `'Shell #' + (N + 1)`
      3. 全是自定义名 → 回退 `'Shell #1'`
    - **删除了 `fallbackId` 参数**，调用处 `createSession()` 同步改为 `computeSmartName()`（无参）。
    - **`rename` 清空时复用**：用户重命名为空字符串时，调用 `computeSmartName()` 自动计算新名称，不再产生 `null`。
    - **影响**：后端永远不产生 `null` 名称，前端无需额外防御。

22. **`cls` 清屏同步已删除（2026-06-30）**：后端 `onData` 中检测 `\x1b[2J`（ESC[2J）后清空 `sessions[id].buffer` 的功能已删除。
    - **原因**：node-pty 的 `onData` 回调可能将转义序列拆分到多个 chunk 中（如 chunk1: `\x1b[2`，chunk2: `J`），导致 `d.includes('\x1b[2J')` 永远检测不到。修复需要跨 chunk 拼接检测，实现复杂且易引入新 bug。
    - **影响**：执行 `cls` / `Clear-Host` 只会清空前端 xterm 显示，后端 buffer 不受影响。缓冲区管理完全由滞回式截断和设置弹窗中的缓冲区上限控制。

23. **Alt+快捷键编码规则（2026-06-30 确认）**：Alt+字母应编码为 Escape+小写字母，而非 Escape+大写字母。
    - 正确：`Alt+A → \x1ba`，`Alt+Z → \x1bz`
    - 错误：`Alt+A → \x1bA`，`Alt+Z → \x1bZ`
    - **原因**：Windows Terminal / PowerShell 对 `\x1bA`（大写）的响应与 `\x1ba`（小写）不同。大写序列可能被解释为其他控制功能而非 Alt+字母快捷键。

24. **按住滚动间隔拆分为终端/页面两项（2026-07-01）**：原 `scrollInterval` 单项配置拆成两个独立字段。Hard break，无旧版本兼容。
    - 字段名：`scrollIntervalTerminal`（终端 SGR 滚轮按钮，默认 100ms）+ `scrollIntervalPage`（页面 xterm 滚视图按钮，默认 100ms），范围 1-1000ms
    - WebSocket 消息类型：`scroll_interval_terminal`（双向同步）+ `scroll_interval_page`（双向同步）
    - 前端 `setupHoldScroll` 签名扩展为 `(btnId, fn, intervalGetter)`：4 个按钮按类型传入对应 getter（终端传 `() => scrollIntervalTerminal`，页面传 `() => scrollIntervalPage`）
    - **周期锁定语义**：`setInterval` 创建时调用 `intervalGetter()` 读一次周期，运行期间不变；按住期间改设置不会影响当前定时器，需释放并再次按住才按新值生效
    - 设置弹窗中「按住终端滚动间隔 (ms)」+「按住页面滚动间隔 (ms)」两个输入框，step=10，min=1

25. **前端日志上限可配置（2026-06-30）**：前端日志上限从硬编码 500 改为 config.json 可配置项。
    - 默认值 50（用户明确指定），范围 10-10000，step=10
    - 滞回式截断：`frontendLogs.length > maxFrontendLogs * 2` 时触发，截断到 `maxFrontendLogs` 条
    - 截断方式：`frontendLogs = frontendLogs.slice(-maxFrontendLogs)`
    - 完整链路：前端变量 → WebSocket `max_frontend_logs` 消息 → server.js 持久化到 config.json → 连接时同步所有客户端
    - `loadConfig` 兜底：非数字/超范围时回退到 50

26. **大/小尺寸切换 + 双槽位（2026-07-01 引入）**：顶栏 `#sizeToggleBtn` 按钮在 large/small 之间切换。设置弹窗分大/小两节，每节独立设置行/列。协议：`size_slots`（C→S 写槽 + S→C 全量广播）/ `current_size`（C→S 切换 + S→C 广播当前尺寸）。旧的 `resize` 消息整条删除（C→S 和 S→C 双向）。**应用 = 切换 + 写槽**：用户点"应用"发两条消息（先 `size_slots` 写槽，再 `current_size` 切尺寸）。**默认值**：large=60×120, small=24×80。**记忆**：服务端通过 `config.currentSize` 字段记忆上次切换结果，连接建立时下发。**校验**：服务端对 sizeMode/size 必须是 'large'/'small'，rows/cols 必须在 20-200 整数范围内，非法值拒收。`config.sizeSlots` 字段是对象，键为 'large'/'small'，值为 `{rows, cols}`。**`current_size` 处理器无"无变化跳过"**（2026-07-01 修复行数不生效 bug）：用户在大尺寸时修改大尺寸行数，size_slots 已更新槽位，但 size 名未变 —— 若早返回则 PTY 和 xterm 都不 resize，必须刷新浏览器才能看到。修复后 `current_size` 始终按最新槽位 resize PTY + 落盘 + 广播。前端的 `sizeSlots` 已由上一条 `size_slots` 广播更新，`current_size` 处理器用 `sizeSlots[currentSize]` resize xterm 时拿到新槽位 → xterm 即时刷新。

27. **前后端日志覆盖（2026-07-01 补全）**：所有 WebSocket 消息都有 `addFrontendLog` 记录（设置弹窗 → 日志 按钮可查看），**唯二例外**：`input`（C→S 键盘输入，每按键都记会产生大量噪音）和 `data`（S→C PTY 输出，每帧都记会产生大量噪音）。**接收侧日志项**（2026-07-01 补全；2026-07-21 移除 `max_buffer`/`client_tail_max`/`buffer_size` 日志项）：`size_slots`（'尺寸槽位已更新'）/ `current_size`（'当前尺寸切换为 大/小 (rows x cols)'）/ `hotkeys`（'快捷键配置已同步'）/ `scroll_interval_terminal`（'终端按住滚动间隔同步为 X ms'）/ `scroll_interval_page`（'页面按住滚动间隔同步为 X ms'）/ `max_frontend_logs`（'日志上限同步为 X 条'）/ `screen_history_lines`（'重连滚屏历史同步为 X 行'）。**发送侧补 1 类**（2026-07-01 补全 → `buffer` 请求于 2026-07-01 因重复移除）：`hot_keys`（'快捷键已同步给服务端'，在 `syncHotkeys` 内）。**不记日志的特例**：
    - （`buffer_size` 已于 2026-07-21 随 legacy 字节流机制移除，不再有该日志特例。）
    - `buffer` 请求：调用点（list 处理器 / createTermInstance / bufferQueue）已记录上下文（'优先加载当前终端' / '新建终端并申请缓存' / '开始加载队列中下一个'），响应侧有'指纹命中跳过/整屏重建'两档覆盖整个拉取过程。**新增 wsSend 处理器时必须配套添加日志**，input/data 类高频消息除外。

28. **服务端权威 + 客户端不乐观更新（2026-07-01 修复）**：设置类 `apply*` 处理器**不应在 `wsSend` 之前修改本地状态**，否则 ws 失败时本地已变但服务器没变，下次重连被服务器覆盖 → "看似应用了" 实际没生效的不一致。**正确模式**：只 `wsSend`，本地状态由 `ws.onmessage` 收到 broadcast 后统一更新（接收侧已有 `xxx = msg.data` 赋值）。**已修复**：`applySettingsScrollIntervalTerminal` / `applySettingsScrollIntervalPage` / `applySettingsMaxFrontendLogs` / `applySettingsScreenHistoryLines` —— 删除 `scrollIntervalTerminal = v` / `scrollIntervalPage = v` / `maxFrontendLogs = v` / `screenHistoryLines = v` 等本地 mutation（旧 `applySettingsMaxBuffer` / `applySettingsClientTailMax` 已随 legacy 字节流机制一并移除）。，删除对应发送侧 `addFrontendLog`（与接收侧 'X 同步为 Y' 重复）。**已是正确模式**（无需改）：`applySettingsSizeFor` / `toggleSize`（size 类只读 sizeSlots/currentSize 不修改）/ `renameCurrent` / `renameAll` / `createNew`（pendingCreate 是创建标志位非配置）/ `killCurrent`（本地 term 由 list 处理器统一删）/ `restartServer` / `syncHotkeys`（hotkeys 已在用户编辑时改）。**fbBtn 保持立即调用**："指令已发出"语义；wsSend 失败时 `wsSend` 内部 catch 会 log 失败原因。**新增 apply 类处理器时**：只发不发本地状态，本地状态由 `ws.onmessage` 接收侧负责更新。

29. **WS 消息顺序：先设置后 list（2026-07-02 重构 + 同日扩展）**：服务端 `wss.on('connection')` 下发顺序为 `size_slots → current_size → screen_history_lines → list`（参考 [server.js L142-L145](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L142-L145)），前端 list 处理器 newIds 分支可直接 `s.resize(sizeSlots[currentSize].cols, sizeSlots[currentSize].rows)` 无条件 resize（参考 [public/index.html L388-L397](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L388-L397)），`requestBuffer()` 用真实的 `screenHistoryLines` 调 headless scrollback。不区分"首次连接"和"后续新建"两条路径。
    - **设计动机**：bug「新建终端时终端变小」原修复是 list 处理器 newIds 加 `if (slot) resize` 守卫（slot 取不到时跳过），由 `current_size` 处理器 `sessions.forEach` 兜底首次连接场景。用户提出两条路径应统一，**根本办法是调整 WS 消息顺序**：让 list 之前一定有 size_slots/current_size，newIds 一定能取到 slot。**同日扩展**：用户进一步指出 `screen_history_lines` 也应该前置——`requestBuffer()` 内部用 `screenHistoryLines` 调 headless scrollback，若 list 之前没到，list 处理器后续 if 块调用 `requestBuffer()` 时 headless 尚未按真实 scrollback 初始化（性能/历史完整性问题，非正确性 bug）。
    - **"影响 list 处理的设置"判定标准**：在 list 处理器（含后续 if 块）中会被立即读取的 JS 变量。当前三条：`sizeSlots` / `currentSize` / `screenHistoryLines`。其他设置（`hotkeys` / `scroll_interval_*` / `max_frontend_logs`）在 list 之后下发不影响 list 处理，按原顺序保持。
    - **current_size 处理器保留**（[public/index.html L484-L491](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L484-L491)）：`sessions.forEach(s => s.resize(...))` 仍负责"用户切换大/小尺寸"时的全量 resize。首次连接时 sessions Map 还没填充（list 未到），forEach 是 no-op；后续 list 到达时 list 处理器统一 resize 新会话。两条路径职责分明：list = 创建新会话并 resize，current_size = 调整现有会话尺寸。
    - **screen_history_lines 处理器保留**（[public/index.html L846-L850](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L846-L850)）：`screenHistoryLines = msg.data` 仍负责“用户在设置弹窗调整 screenHistoryLines”时立即更新本地变量、回填输入框、并记一条 in 日志。首次连接时 sessions 还没填充（list 未到）无影响；客户端变量同步由 connection 时的 screen_history_lines 消息兜底，服务端据此调整 headless 终端的滚屏历史边界。
    - **安全性**：
      - 首次连接：size_slots → current_size → screen_history_lines → list 顺序下发，list 到达时三个变量都已就绪 ✓
      - 非首次连接的新建：客户端 JS 变量 sizeSlots/currentSize/screenHistoryLines 保留，list 到达时立即 resize + requestBuffer 用真实 screenHistoryLines ✓
      - 断网重连：服务端不重发这些设置（客户端变量不丢），list 到达时正常处理 ✓
      - 用户刷新页面后 100ms 内点新建：connection 还没建立时 wsSend 直接 return（pendingCreate 置位但 create 消息未发出），无 list 处理 ✓
    - **不要回退消息顺序**：原顺序（list 在最前）会导致两条逻辑分裂的兜底路径。

30. **首次连接时 createSession 内 broadcast 破坏 list 顺序（2026-07-03 修复）**：上面注意事项 29 说"首次连接顺序下发 size_slots → current_size → screen_history_lines → list"，但**实际首版实现漏了一个细节**：`wss.on('connection')` 第一行 `if (Object.keys(sessions).length === 0) createSession();` 在所有 `ws.send` 之前调用，而 `createSession()` 内部 L133 `broadcast(buildListMsg())` 立即把 list 发给所有 `wss.clients`（ws 库的 connection 事件触发时新 ws 已被加入 clients Set，因此新 ws 也会收到）。
    - **症状**：用户报"首次连接页面报错 Uncaught TypeError: Cannot read properties of undefined (reading 'cols') at L414"。`s.resize(slot.cols, slot.rows)` 的 `slot` 是 `undefined`。原因：list 消息在 size_slots/current_size 之前到达客户端，list 处理器 newIds 分支执行时前端 `sizeSlots` 仍是默认 `{large: null, small: null}`、`currentSize` 仍是默认 `null`，`sizeSlots[null]` = `undefined`。**仅首次连接触发**（后续连接 sessions 非空，跳过 createSession，不触发 broadcast，ws.send 顺序正确）。
    - **修复**（[server.js L136-L155](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L136-L155)）：把 createSession 调用移到 `ws.send(size_slots/current_size/screen_history_lines)` 之后，并加 if/else 分流：
      - 首次连接：`ws.send` × 3 → `createSession()`（内部 broadcast 包含新会话的 list 给新 ws）
      - 非首次连接：`ws.send` × 3 → `ws.send(list)`
    - **客户端接收顺序统一**：两种情况都是 `size_slots → current_size → screen_history_lines → list`，无重复 list，无顺序错乱。
    - **历史回顾**（2026-07-02）：之前 `isFirstList` + `if (slot) resize` 兜底正是为了掩盖这个 bug（首版 list 处理器在 size_slots 未到时跳过 resize）。**根因修复后**这条防御仍然存在（`if (slot) resize`），但实际上只要服务端按正确顺序下发，slot 永远不为 null，兜底分支是死代码。**不要简化掉** `if (slot) resize` —— 兜底无成本，保留作为"服务端协议有变动时"的最后一道防线。
    - **教训**：`broadcast()` 在 `connection` 回调内同步触发的副作用要特别小心 —— 它会发给**所有**已 connected 的 ws，包括当前正在 connection 的那个。任何"先设置后 list"的设计都要确认 broadcast 不会在 ws.send 之前跑出去。**后续协议设计规则**：所有"在 connection 块内对当前 ws 发送的、且 broadcast 不应抢先的消息"，必须确保 broadcast 触发点在所有必要的 ws.send 之后。

31. **`Get-ExecutionPolicy` 模块加载失败修复（2026-07-04）**：`Get-ExecutionPolicy -List` 在 web 终端中报 `CouldNotAutoloadMatchingModule`。
    - **根因**（排查过程）：
      1. `-ExecutionPolicy Bypass` 无效 → 不是 execution policy 问题
      2. `-NoProfile` 无效 → 不是 profile 问题
      3. 测试发现 `powershell.exe` 通过 PATH 解析到 `C:\WINDOWS\system32\WindowsPowerShell\v1.0\powershell.exe`（Windows PowerShell 5.1），而非 PowerShell 7
      4. PM2 进程的 `PSModulePath` 环境变量中包含了 PowerShell 7 的模块路径（来自 WindowsApps 的 `...\Modules`）
      5. PS5.1 自动加载 `Microsoft.PowerShell.Security` 时优先找到 PS7 版本的类型数据文件（`.types.ps1xml`），其定义的类型（`AuditToString` 等）与 PS5.1 不兼容 → `CouldNotAutoloadMatchingModule`
      6. `Import-Module` 测试确认是**终止错误**（`FormatXmlUpdateException`），模块完全无法加载
    - **修复**（[server.js L110-L119](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L110-L119)）：
      1. 将 spawn 目标从 `'powershell.exe'` 改为 `'pwsh.exe'`（显式使用 PowerShell 7，而非被 PATH 解析到 PS5.1）
      2. 参数：`-ExecutionPolicy Bypass`（无 `-NoProfile`，保留 profile 加载）
      3. **不**过滤 `PSModulePath`：spawn 选项不传 `env`，node-pty 默认继承父进程 env。PS7 的 PSEdition-aware 模块加载能正确挑出 PS7 版本模块，PS5.1 路径在不在 `PSModulePath` 里都不影响。
    - **历史**：修复当日曾加过 `PSModulePath` 过滤（`!p.includes('windowspowershell')`），同日经对照实验验证后移除：过滤不仅多余（PS7 自身能区分版本），还误删了 `C:\Program Files\WindowsPowerShell\Modules` 这条 PS5.1/PS7 共享的 AllUsers 模块安装路径，导致用户用 `Install-Module -Scope AllUsers` 装的模块在 web 终端里找不到。对照实验：同父进程 env 下，过滤与不过滤两种方式 spawn `pwsh.exe`，`Get-ExecutionPolicy -List` 均正常，`Microsoft.PowerShell.Security` 均加载 7.0.0.0 PS7 版本。
    - **影响**：终端运行在 PowerShell 7（`pwsh.exe`）。`Get-ExecutionPolicy -List` 等命令正常工作，profile 脚本正常加载。

32. **快捷键编辑器拖拽排序（2026-07-07 引入）**：快捷键编辑弹窗里的「上移」按钮过于笨拙，改为 HTML5 拖拽。设计要点：
    - **DOM 结构**：每行 `.hotkey-item` 加 `draggable="true"` + `data-hotkey-name="${n}"`，左侧加 `<span class="drag-handle">☰</span>` 提示可拖。原「上移」按钮删除，对应 `moveUp()` 函数一并删除。
    - **事件绑定**：拖拽事件不能用 inline（需读 `currentTarget.dataset`），因此在 `openHotkeyEditor()` 末尾调 `bindHotkeyDragSort(editorDiv)`，内部用 `addEventListener` 挂 `dragstart / dragend / dragover / dragleave / drop` 五个。
    - **插入位置判断**：用 `dragover` 时的 `e.clientY` 与目标项 `getBoundingClientRect()` 中线的相对位置决定：上半部分 → 插到它前面，下半部分 → 插到它后面。不用 `e.target`（避免嵌套子元素 `.drag-handle / .hk-label / button` 事件源判断复杂）。
    - **数组重建逻辑**：`splice(fromIdx, 1)` 取出后使用 `order.indexOf(targetName)` 重新定位目标的新索引，再根据 `insertBefore` 决定是否 `+1`，最后 `splice(newIdx, 0, draggedName)` 插入。同位置拖回自己的情况被 `draggedName === targetName` 拦截。
    - **指示反馈**：CSS 加 `.dragging` (opacity 0.4) + `.drag-over-top` (border-top 蓝色 2px) + `.drag-over-bottom` (border-bottom 蓝色 2px)。`dragover` 每次先清除所有 `.hotkey-item` 的两个提示类再加到当前项，避免多项同时点亮。
    - **`dragleave` 减震**：该事件在进入子元素时也会冒泡触发，需用 `if (!item.contains(e.relatedTarget))` 只在真正离开 `.hotkey-item` 边界时才清除提示类。
    - **`dragend` 清场**：拖拽被取消（拖出窗口 / Esc）时也会触发，里面要同步清除所有指示类和 `draggedName`。
    - **`dataTransfer.setData` 必须调**：否则 Firefox 拒绝 drag；`effectAllowed = 'move'` + `dropEffect = 'move'` 保证光标变型。
    - **服务端透明**：拖完后调 `syncHotkeys()`，服务端 `hotkeys` 协议与上移按钮时完全一致，仅是前端推动顺序的方式变了。`config.json` 保持原有字段，无需迁移。
    - **性能影响**：拖拽仅限快捷键编辑弹窗内（默认 14 行），事件总量 < 70（14 × 5），DOM 重建仅在 drop 后触发一次（`syncHotkeys` → `服务端广播` → `接收侧 hotkeys 处理器` → `renderHotkeys`）。无内存泄漏。
    - **不需重启服务器**：纯前端改动，刷新页面即可加载。

33. **直接发送快捷键面板「发按键」（2026-07-12 引入）**：底部快捷键栏**最左**新增「发按键」按钮（位于 `#hotkeysList` 之外、`#hotkeys-bar` 直接子元素），点击弹出小面板。面板内勾选修饰键（Ctrl/Alt/Shift，可多勾，`.mod-active` 高亮）+ 点主键（字母/功能键），**点主键即当场把组合序列通过 `sendInput(parseHotkey(组合名))` 发到当前活动终端**，不预设、不持久化、`server.js` 与 WebSocket 协议完全不动。发完面板自动关闭（一次一个），下次打开 `activeMods` 已清空。
    - **复用**：`parseHotkey()`（Ctrl 大写公式 / Alt 小写 / Shift 规则不变）、`sendInput()`（→ `wsSend input`）、`activeId`。
    - **新增常量**：`MODIFIER_KEYS = ['Ctrl','Alt','Shift']`、`PRIMARY_KEYS`（与 `availableKeys` 内容相同但是独立常量，原 `availableKeys` 保留不动）。
    - **按钮位置关键**：放在 `#hotkeysList` **之外**（作为 `#hotkeys-bar` 直接子元素），因为 `renderHotkeys()` 内 `bar.innerHTML=''` 会清空 `#hotkeysList` 全部子节点再重建（只重附 `editBtnEl`/`scrollGroupEl`），放外面可避开被误清。发按键本质是与预设快捷键**不同语义**的独立组合器入口，刻意不混进预设键列表。**布局修复（2026-07-12）**：曾出现发按键独占一行的 bug——`#sendKeysBtn` 与 `#hotkeysList` 是 `#hotkeys-bar` 的两个 flex 子项，`#hotkeysList` 展开宽度逼近终端宽度时 `flex-wrap` 把它挤到下一行。修复用纯 CSS：`#sendKeysBtn{flex-shrink:0;align-self:flex-start}`（永不被压缩、始终最左、多行时顶端对齐）+ `#hotkeysList{flex:1 1 0;min-width:0}`（占剩余宽、内部 `flex-wrap` 换行而非把自己顶到下一行），两者稳定同行并排。
    - **修饰键高亮坑位（2026-07-12）**：`.mod-active` 原只写 `.mod-active { background:#2d6cdf }`，但通用 `button:hover { background:#505050 }` 的 CSS 优先级 (0,1,1) 高于 `.mod-active` (0,1,0)，导致**勾选修饰键后鼠标悬停时蓝底被灰底盖掉**（点完移开才变蓝、悬停又变灰）。修复：选择器合并为 `.mod-active, .mod-active:hover`，显式让 hover 态也保持蓝底（specificity 升到 (0,2,0) 胜出）。以后新增高亮类若与 `button:hover` 共存，必须带上 `:hover` 同款选择器。
    - **性能**：弹窗打开创建约 50 个按钮节点（仅面板生命周期内，关闭即销毁），零新增网络、零协议变更，可忽略。
    - **纯前端改动**：只改前端不重启服务器，连现有 65433 刷新即可。

34. **Ctrl+C 选区复制 + Toast 提示（2026-07-12 引入）**：当 xterm 存在选区时，三种发送路径（键盘 / 底部快捷键按钮 / 发按键面板）的 Ctrl+C 都改为**复制选区到剪贴板并清除选区**，不再发送中断 `\x03`；无选区时 Ctrl+C 仍正常发 `\x03` 中断。复制成功时在终端右上角显示蓝底 Toast「已复制」，复制失败时显示红底 Toast「复制失败」，停留 1.5 秒后自动消失（带从右侧滑入/滑出的 CSS 过渡动画），允许堆叠（每个向上偏移 40px）。纯前端改动（`public/index.html` + `public/term-session.js`），不动 `server.js`、不加 WebSocket 消息。`copyToClipboard` / `fallbackCopy` 返回实际写入结果（`Promise<boolean>`），`copyTermSelection` 内部统一显示 Toast。键盘路径用 `term-session.js` 构造里的 `wrapper` 捕获阶段 `keydown` 监听拦截；按钮与面板改调 `sendInputMaybeCopy`。行为始终开启，无设置开关。

35. **底部输入条（2026-07-13 引入）**：「发按键」右侧新增「输入条」按钮，点开后在同一行内联展开一个多行输入框（`#inputBarText`，`scrollHeight` 自动增高，`max-height:160px` 后转滚动）。回车（Enter）即「发送」：在 textarea 内按 Enter 把内容发到当前 xterm——先 `replace(/\n+$/,'')` 去末尾换行，空则仅不发送（不关闭），否则把 `\n→\r` 的序列**整段作为一条 `input` 消息一次性发出**（与右键粘贴同路径），停顿 `ENTER_DELAY(300ms)` 后**单独发一条 `\r` `input` 消息**模拟手动回车=确认/执行，随后清空内容并保持展开。原「发送」按钮已改为「换行」(`#inputBarSend`)：在光标处插入一个换行（`\n`）；空内容时点击它不做事并退出输入条。展开时 `#inputBarBtn`（输入条入口按钮）与 `#hotkeysList`（编辑/滚动按钮）均 `display:none` 隐藏、输入条铺满整行中间——最左是「发按键」、最右是「换行」、两者之间的全部空间都是输入条（`#inputBarWrap` `flex:1 1 0` 填满整行、`#inputBarText` `flex:1` 占满中间、`gap:0` 使输入框右边缘紧贴「换行」按钮，无空隙）；收起/再点按钮恢复。`Esc` **仅清空内容、不关闭**输入条（光标留在框内，可继续输入）。**焦点移出**：输入框展开时点击终端/页面空白等使 textarea 失焦，触发 `blur` 监听（`relatedTarget` 在 `#inputBarWrap` 外才关闭）关闭输入条并**保留草稿**，下次点开原样恢复；点击「换行」按钮（在容器内）不误关。`openInputBar()` 不再清空 `value`，草稿由 textarea 自身留存（仅当前会话，不跨刷新）。`sendInputBar()` 回车发送后**清空内容但保持展开**（便于连续输入），走 `clearInputBar()`；`closeInputBar(clear=true)` 默认清空关闭（「换行」空内容退出用），`closeInputBarPreserve()` 保留关闭（焦点移出用）。`sendInputBar()` 直接调 `wsSend({type:'input', id: targetId, data: textSeq})` 与 `wsSend({type:'input', id: targetId, data: '\r'})`（`targetId` 发送前捕获），**不动 `server.js`、不加 WebSocket 消息**。纯前端改动：改 `public/index.html`（DOM + `toggleInputBar/openInputBar/closeInputBar/autoGrow/sendInputBar`）+ `public/styles.css`，刷新网页即生效。**移动端软键盘（2026-07-13 修复）**：关闭类路径（`closeInputBar()`，用于 toggle 关闭、「换行」空内容退出、焦点移出保留）先 `sessions.get(activeId)?.focus()` 把焦点交还当前终端再隐藏 textarea，避免 textarea 隐藏瞬间失焦导致键盘收回——与其他快捷键按钮行为一致（点完按钮键盘仍挂在终端输入框上）。**回车发送与 Esc 走 `clearInputBar()`，不移动焦点、输入框保持展开，软键盘不收回**，便于连续输入。全局 `pointerdown` 拦截（`index.html` 末尾 `document.addEventListener('pointerdown', ... if (e.target.closest('button')) e.preventDefault())`）已阻止按钮抢焦点，本修复补全"关闭后交还终端焦点"这一环。

- **整段发送 + 回车分离（2026-07-14 修改，原逐字符发送）**：`sendInputBar()` 把 `文本.replace(/\n/g,'\r')`（**不含末尾回车**）作为**一条** `input` 消息整段发出，停顿 `ENTER_DELAY=300ms` 后**单独发一条 `\r` `input` 消息**=确认/执行。根因：逐字符发送时每字符一条独立消息、间隔 15ms，TUI 始终在逐键交互模式，长命令超过行编辑器长度上限报错 `windows ctrl+v may block large input for large paste. use alt+v for fast paste`；右键粘贴是整段一次性 `pty.write`，TUI 进入粘贴/快速模式绕过上限故正常。回车分离原因：整段 blob 里的 `\r` 在粘贴模式被当字段内换行而非执行（即 2026-07-13 原逐字符要解决的坑），故把末尾回车从 blob 中拆出、延迟后单独发，让 TUI 当一次手动回车=执行。`\n→\r` 归一保留（终端回车键产生 `\r` 而非 `\n`，TUI raw 模式只认 `\r` 作换行/确认信号）。发送前捕获 `targetId = activeId`，发送途中切换会话不串台；`if (!targetId) return` 仅保护「捕获时无活动会话」情形，真正断连由 `wsSend` 内部静默失败兜底。纯前端改动，刷新即生效。

    - **输入条动作可配置（2026-07-15 引入）**：右侧按钮动作（`inputBarButtonAction`：换行/发送，默认换行）、Enter 键动作（`inputBarEnterAction`：换行/发送，默认发送）、发送后是否关闭输入条（`inputBarCloseAfterSend`：布尔，默认 false 保持展开）三个行为均可在设置弹窗随时调整并**多端同步**。完整链路同 `swipe_*`：`config.json` 字段 → `loadConfig` 默认值+校验 → 连接时下发 → ws handler 校验+`saveConfig`+`broadcast` → 前端 `apply*` 只 `wsSend`（服务端权威）→ 接收侧更新变量+日志。右侧按钮 `onclick` 改分发函数 `inputBarRightButton()`（按 `inputBarButtonAction` 调 `sendInputBar`/`insertNewline`），按钮文字由 `applyInputBarButtonLabel()` 随设置切换「换行」/「发送」；Enter 键按 `inputBarEnterAction` 分支；`sendInputBar()` 末尾按 `inputBarCloseAfterSend` 决定 `closeInputBar()`（收起）或 `clearInputBar()`（保持）。无 Shift+Enter 兜底（严禁过度设计）。设置弹窗控件：两个 `<select>`（应用按钮 + `fbBtn` 反馈）+ 一个勾选框（即时应用 + `flashHint`）。

36. **底部快捷键栏单行横向溢出滚动（2026-07-13 引入）**：底部栏（`#hotkeys-bar`）从 `flex-wrap: wrap`（多行换行）改为 `flex-wrap: nowrap; overflow-x: auto`（单行、超宽则横向溢出滚动）。`#hotkeysList` 从 `flex: 1 1 0; min-width: 0`（撑满）改为 `flex: 0 0 auto`（按内容真实宽度排列，超宽才溢出），其内联样式 `flex-wrap: wrap` 改 `nowrap`。底部栏所有按钮追加 `#hotkeys-bar button { flex-shrink: 0; white-space: nowrap }`，横滑时不被压缩、文字不折行。`#hotkeys-bar { touch-action: pan-x }` 兜底移动端横向 pan（手指从按钮上起滑也能横滑，不受全局 `pointerdown` `preventDefault` 影响）。**范围**：`发按键`/`输入条`/快捷键/`编辑`/滚动按钮全部在同一行一起随滑动移出屏幕（不钉住左侧）；纯 CSS 改动（`public/styles.css` + `public/index.html` 一行内联），不动 `server.js`、不加 WebSocket 消息、不加 JS 事件、不加 DOM 节点。输入条展开模式（隐藏 `#hotkeysList`、`#inputBarWrap` 独占整行）不受影响。验收：桌面端出现横向滚动条 + Shift+滚轮横滑；Android 真机手指横滑把最右「编辑/滚动按钮」拉回屏幕。

37. **触摸横滑底部栏不再误发 SGR 滚轮序列（2026-07-13 修复）**：注意事项 36 引入单行横滑后，真机横滑若落点在滚动按钮（`scrollUp/Down`、`scrollXtermUp/Down`）上，原 `setupHoldScroll` 的 `pointerdown` 立即 `fn()` + `setInterval` 会因**触摸隐式指针捕获**（`pointerleave` 整个手势期间不触发）持续把 SGR 滚轮序列（`\x1b[<64;y;1M`/`\x1b[<65;y;1M`，见 `term-session.js` `sendSgrWheel`）灌到后端。修复（`public/index.html` `setupHoldScroll`）：鼠标保持「按下即发 + 持续」；触摸/笔改为延迟 120ms 首发，期间若 `pointermove` 位移超 8px 判定为横滑底部栏 → 取消、零误发；轻点（未超阈值且未激活）= 发一次，按住 = 持续。新增 `pointercancel` 停止。纯前端改动，刷新网页即生效，不需重启服务器。

38. **Ctrl+V 粘贴（2026-07-13 引入）**：捕获阶段 `keydown` 监听（现用于 Ctrl+C 复制，见注意事项 34）中新增 Ctrl+V 分支——拦截 `Ctrl+V`（`preventDefault` + `stopPropagation`），调 `pasteFromClipboard(term, id)` 读系统剪贴板并写进 PTY，覆盖 xterm 默认的 `\x16` 转发。**根因**：右键"粘贴"走 xterm 默认 `paste` 事件（读剪贴板链路）所以通；Ctrl+V 被 xterm 当键盘字符 `\x16` 吞掉并 `preventDefault` 掉浏览器原生 paste 事件，所以失效。**范围**：仅 `Ctrl+V`（不含 `Ctrl+Shift+V` / `Shift+Insert`），全局生效（含普通 PowerShell 变粘贴语义），成功不弹 Toast、仅失败时弹红色「粘贴失败(无法访问剪贴板)」。换行归一化 `\r\n`→`\r`、单 `\n`→`\r`（与 xterm 默认 paste 一致）。用 `this.id` 直接发避免切会话串台。纯前端改动（`public/index.html` 新增 `pasteFromClipboard` + `public/term-session.js` 扩展监听），不动 `server.js`、不加 WebSocket 消息、不加协议，刷新即生效。安全上下文：`localhost`/`https` 可用 `navigator.clipboard.readText()`；仅"局域网 IP + http"拿不到，降级为失败 Toast（浏览器限制，无读取兜底）。

39. **滑动手感设置 + 按钮合并 + 显隐（2026-07-14 引入）**：把触摸滑动阈值/判定阈值做成多端同步设置、把 4 个滚动按钮合并为 2 个、并新增滚动按钮显隐的多端同步设置。
    - **配置字段**：`config.json` 新增 `swipeThreshold`(24, 1-200) / `swipeClassify`(10, 1-100) / `showScrollButtons`(true)。`loadConfig` 仅默认值兜底，无老用户迁移（单一用户）。
    - **WebSocket 消息**：`swipe_threshold` / `swipe_classify` / `show_scroll_buttons`（C→S 设置 + S→C 广播），字符串与前端 `apply`/`接收` 完全一致。服务端 handler 校验范围后落盘 `saveConfig` + 广播所有客户端；连接建立时下发（在 `scroll_interval_page` 之后）。
    - **按钮合并 4→2**：`#scrollGroup` 内 `▲上滑`/`▼下滑`/`▽到底页面` 三个按钮（原 4 个含"上滑/下滑页面"已删）。`setupHoldScroll` 绑定改为 `scrollUpBtn`→`smartScroll(-1)`、`scrollDownBtn`→`smartScroll(1)`，按住间隔由新 `getScrollInterval()` 按当前会话模式自适应（TUI 鼠标追踪开→`scrollIntervalTerminal`，否则→`scrollIntervalPage`）。原 `scrollUp`/`scrollDown`/`scrollXtermUp`/`scrollXtermDown` 四个函数因被 `smartScroll` 完全取代已删除。`scrollBottomBtn` 仍绑 `scrollBottom`。
    - **滑动手感参数可变**：原触摸块内 `const SWIPE_THRESHOLD/SWIPE_CLASSIFY` 改为顶部全局 `let swipeThreshold/swipeClassify`，`onTouchScrollMove` 引用随之替换，连接建立后由 `swipe_threshold`/`swipe_classify` 广播更新、实时生效无需刷新。
    - **显隐**：`styles.css` 新增 `.hidden { display:none !important }`；`applyScrollButtonsVisibility()` 按 `showScrollButtons` 给 `#scrollGroup` 切 `.hidden`（含"到底页面"一起隐藏），初始化调用一次，接收侧 `show_scroll_buttons` 时调用。设置弹窗"显示滚动按钮"勾选框（即时应用：勾选/取消即 `wsSend`，无"应用"按钮，旁侧 `flashHint` 闪现"✓已应用"）。`通知声音`/`通知 Toast` 两个勾选框同理（2026-07-15 起 3 个勾选框均改为即时应用）。
    - **设置弹窗**：`buildSettingsModal` 在"按住页面滚动间隔"行后加 3 行（滑动滚动阈值/滑动判定阈值/显示滚动按钮），`openSettingsModal` 同步当前值，`applySettingsSwipeThreshold/Classify/ShowScrollButtons` 三个 apply 函数只 `wsSend`（服务端权威，不本地改状态），接收侧 3 分支更新全局变量 + `applyScrollButtonsVisibility` + 前端日志。
    - **性能**：仅变量/class/按钮合并，无额外 DOM 节点或监听器开销；纯设置类改动。
    - **范围**：改了 `server.js`（Task 1 后端配置链路）→ 需 PM2 重启后端才生效；前端刷新即加载新静态文件。

40. **输入条高度对齐侧边按键（2026-07-14 修复）**：底部栏输入条展开后，textarea（`#inputBarText`）高度原先比左右按键（发按键/换行）高出一截、且文字离框底有较大的空白，视觉不和谐。
    - **根因**：单行/空状态的 textarea 高度由 `autoGrow()`（`public/index.html`）设 `height = scrollHeight`（内容高 + 上下 padding，不含边框）决定，与按钮高度公式相同，差异在**垂直 padding**（textarea 原上下各 4px，按钮上下各 6px）+ 真实浏览器单行行盒渲染使底部留白偏大。
    - **修复**：`public/styles.css` `#inputBarText` 的 `padding` 由 `4px 6px` 逐步收紧为 `4px 6px 2px` 最终 `4px 6px 0`（仅收底部，顶部与左右不变），文字贴框底、整体高度贴近侧边按键，用户验收"刚好对齐"。
    - **不含写死高度**：保持 `autoGrow`（`height = scrollHeight`）+ `overflow: auto` + `max-height`（原 `160px`，2026-07-21 改为 `50vh`，见条目 43），单行内容恰好塞进框、**无滚动条**；多行照常增长。此前"强行写死 height"导致滚动条的坑不复现。
    - **范围**：纯前端 `styles.css` 一处改动，刷新即生效，不动 `server.js`/协议；如需像素级锁死对齐，备选方案为运行时读取「换行」按钮 `clientHeight` 反推 textarea 高度（未采用，当前 padding 法已满足）。

- **通知子系统已于 2026-07-22 移除**：原 BEL/Toast/系统通知/飞书推送/doneToken 触发链全部删除，改由用户侧的 CodeBuddy hooks 飞书通知承担。如需恢复，见 `docs/superpowers/RECOVERY-remove-notifications.md`。
42. **回车停顿设置项 enterDelayMs（2026-07-15 引入）**：输入条发送文本时「整段正文发出」与「单独发 `\r` 回车」之间的停顿，原为硬编码 `ENTER_DELAY=300ms`，现改为可配置、多端同步的设置项 `enterDelayMs`（默认 300，范围 50–3000，step 50）。完整链路：`config.json` 字段 → `loadConfig` 默认(300)+兜底(越界回退 300) → 连接时 `ws.send({type:'enter_delay_ms'})` 下发 → ws handler 校验(非整数/越界拒收)+`saveConfig`+`broadcast` → 前端 `applySettingsEnterDelay()`（只 `wsSend`，服务端权威）→ 接收侧 `enterDelayMs = msg.data` + 前端日志。`sendInputBar()` 内 `await sleep(enterDelayMs)` 取代 `await sleep(ENTER_DELAY)`；`ENTER_DELAY` 常量已删除。Enter 键发送（`inputBarEnterAction==='send'`）与右侧「发送」按钮（`inputBarButtonAction==='send'`）共用 `sendInputBar()`，停顿两者同步受控。设置弹窗「输入条动作」组新增「回车停顿 (ms)」行（number input + 应用按钮，沿用 `swipe_threshold` 模式，非即时应用）。**改了 `server.js` 需 `npm run restart`**（由用户执行，AI 不擅自重启）。

43. **输入条向上扩展吸底（2026-07-21 修复）**

44. **登录认证归 server.js（2026-07-27）**：nginx `/cmd/` 不再做 `auth_basic`，仅 TLS 反代。`server.js` 用无状态签名 cookie `rc_session` 鉴权，每次 WS 升级（含重连）都验，过期→拒连→前端跳 `/login`。密码复用 nginx `htpasswd`（实时读取校验 `{SHA}`），零新依赖。`sessionDurationMin`（默认 1440，范围 1–20160）是普通可同步设置项，影响下次登录的 cookie 有效期。前端用相对 URL + `X-Forwarded-Prefix` 兼容 `/cmd/` 前缀与直连。改 `config.json` 的 `sessionDurationMin`/`sessionSecret`/`htpasswdPath` 前先 `cp config.json config.json.bak`（config.json 不进 git）。：输入条展开输入超过一行时，文本框原先**向下**扩展，把整个页面撑得比屏幕还高，底部「发按键 / 换行」按钮被挤到屏幕外，需下滑才能看到全部内容。改为文本框**向上**扩展、盖住终端底部一部分，且按钮始终贴屏幕底可见。
    - **根因**：`#hotkeys-bar` 与 `#inputBarWrap` 为 `align-items: flex-start`（按钮贴顶、文本框向下长）；底部栏处于正常文档流，页面总高超过视口后其底边掉出屏幕底边。
    - **修复**（`public/styles.css`，纯 CSS，不动 `server.js`/协议/`autoGrow`）：
        - `#hotkeys-bar` 加 `position: sticky; bottom: 0` 锁视口底边；因 sticky 保留在 `#page` 流盒内，宽度自动等于终端宽度（**未用 `fixed`**，否则变全屏宽）。
        - `#hotkeys-bar`、`#inputBarWrap` 的 `align-items` 由 `flex-start` 改 `flex-end` → 文本框底边与按钮底边平齐，多行时文本框向上长盖住终端。
        - `#inputBarText` 上限 `max-height: 160px` → `50vh`，超半屏后内部滚动（`overflow: auto` 已具备）。
        - `#hotkeys-bar` 加不透明 `background: #1e1e1e`，吸底盖住终端时文字不透出。
        - `html` 加 `interactive-widget: resizes-content`，安卓软键盘弹起时锁底栏停在键盘上方（现代 Chrome 默认 `resizes-visual` 已如此；不引入 `visualViewport` JS）。
        - `autoGrow()`（`public/index.html`）未改，仍 `height = scrollHeight` + `max-height` 钳制渲染高度。
    - **验证**：`tests/input-bar-upward-check.mjs` 用 Playwright 直接打开真实运行服务（`http://localhost:65433`），量 `getBoundingClientRect`/`getComputedStyle` 真实像素断言——`sticky` 且 `bottom: 0px`、两条 `flex-end`、文本框 `max-height ≈ 50vh`、栏背景不透明、文本框与终端重叠、文本框底边与「换行」按钮底边平齐、输入条底边贴视口底；基线（改前）FAIL、改后 PASS。Playwright 以 `npm i playwright --no-save` 临时装入，未写入 `package.json`。
    - **范围**：纯前端 `styles.css` 改动，刷新即生效，不动 `server.js`/协议。已知小瑕疵：xterm 默认背景黑 `#000000`、栏背景 `#1e1e1e`，吸底盖住终端时顶边有一道色阶（与现有 toolbar/终端 色差一致，非新回归，可选统一）。安卓真机（HTTPS）键盘场景由用户真机验收。

## 开发工作流

- **只改前端时不要重启服务器**：测试前先用 `Get-NetTCPConnection -LocalPort 65433` 检查后端服务器是否在跑。如果在跑就直接连现成的服务器测网页（静态文件刷新即可加载新前端）。只有改了 `server.js` 时才需要重启服务。
- **PM2 重启纪律**：以后所有重启操作必须通过 PM2（`npm run restart` 或前端设置弹窗的「重启服务器」按钮），**禁止直接 taskkill / kill 进程**，否则会破坏 PM2 的进程管理状态。非 PM2 方式杀进程后，PM2 会误认为进程仍在管理下，导致 `pm2 restart` 失败。
- **AI 禁止私自重启服务器（2026-07-14 用户明确）**：改完 `server.js` 后代码可以照常提交，但**重启动作只能通知用户、由用户自己执行**（"请运行 `npm run restart`"），AI 绝不可自己执行 `npm run restart` / `pm2 restart` 等任何重启命令。**唯一例外**：用户明确授权"你可以自己重启"时才可执行。只读检查（如连 WS 看下发消息）不算重启，可以做。
- **每次代码改动必须附带性能影响分析**：在计划阶段或提交改动时，分析改动涉及的 DOM 操作量、事件监听器数量、布局/回流影响、内存开销、执行频率等关键指标。可忽略的影响也需明确说明理由。纯文档/注释/配置变更除外。

## 更新规则

- **每次修改需求或更新注意事项后，必须同步更新本文件。**
- **每次对本文件进行修改后，必须通知用户。**