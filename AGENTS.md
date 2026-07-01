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
| 配置 | `config.json` | ~21 | 持久化配置：`rows`、`cols`、`hotkeys`（名称→转义序列）、`scrollInterval`、`maxBuffer`、`maxFrontendLogs`、`clientTailMax`（buffer 尾部比对长度，单位：bytes，默认 4096） |

### WebSocket 协议（JSON，type 字段）

**服务端 → 客户端：**

| type | 说明 |
|------|-------------|
| `list` | 当前会话 ID 列表（连接时及会话变更后发送） |
| `data` | 指定会话的终端输出（id + data） |
| `buffer` | 历史缓冲区响应（id + data + 可选 pos）。`pos` 存在 = 档 2 增量推送（客户端只 write 追加）；`pos` 缺席 + `data === ''` = 档 1 未变更（客户端跳过）；`pos` 缺席 + `data !== ''` = 档 3 全量回放（客户端 reset + write） |
| `size_slots` | 大/小尺寸槽位全量广播（data: {large: {rows, cols}, small: {rows, cols}}），连接建立时下发 + 客户端写槽后广播 |
| `current_size` | 当前尺寸广播（data: 'large' \| 'small'），连接建立时下发 + 客户端切换后广播 |
| `hotkeys` | 快捷键配置同步 |
| `scroll_interval` | 按住滚动间隔（单位：ms） |
| `max_buffer` | 缓冲区上限值（单位：MB） |
| `max_frontend_logs` | 前端日志上限值（单位：条） |
| `client_tail_max` | 客户端 buffer 尾部比对最大长度（单位：bytes），连接建立时下发 + 设置变更时广播 |
| `restart_server` | 服务端重启确认（data: 'ok'） |
| `buffer_size` | 当前会话 buffer 占用查询响应（id + used + max，单位：字符数） |

**客户端 → 服务端：**

| type | 说明 |
|------|-------------|
| `create` | 创建新会话 |
| `input` | 向会话写入数据（id + data） |
| `kill` | 关闭会话（id） |
| `buffer` | 请求会话的缓冲区回放（id + 可选 tail，tail 是客户端最近 N 字节原始字符串，默认 N = config.clientTailMax）。服务端按 `endsWith` → `lastIndexOf` → 全量 三档响应（见注意事项 18） |
| `size_slots` | 写大/小尺寸槽位（sizeMode: 'large'\|'small' + rows + cols），服务端会写槽 + 落盘 + 全量广播 |
| `current_size` | 切换当前尺寸（size: 'large'\|'small'），服务端会切换 + 调所有 PTY + 落盘 + 广播 |
| `hot_keys` | 更新快捷键配置（data） |
| `scroll_interval` | 更新按住滚动间隔（data，单位：ms） |
| `max_buffer` | 更新缓冲区上限（单位：MB） |
| `max_frontend_logs` | 更新前端日志上限（单位：条） |
| `client_tail_max` | 更新客户端 buffer 尾部比对最大长度（data，64 ≤ data ≤ 65536） |
| `restart_server` | 触发服务端重启（PM2 自动重启） |
| `buffer_size` | 查询当前会话 buffer 占用（id） |

### 会话生命周期

- 每个会话 = `sessions{}`（内存映射）中的 `{ pty: IPtyProcess, buffer: string }`。
- 缓冲区上限以 **MB** 存储（默认 10 MB，1 MB = 1,000,000 字符），通过 `config.json` 的 `maxBuffer` 字段配置。**滞回式截断**：`ptyProcess.onData` 中只有当 `buffer.length > maxBufferChars * 2` 时才触发 `slice(-maxBufferChars)`；日常写入路径只做 `buffer += d`（V8 rope 字符串摊销 O(1)）。`maxBufferChars` 是模块级缓存变量，仅在 `loadConfig` 和 `max_buffer` 消息处理时重算。
- 进程退出时，删除该会话并向所有客户端广播 `list`。
- 首次 WebSocket 连接时若没有会话，自动创建一个。
- 后端使用数字 ID 跟踪会话（`sessionCounter++`）。

## 关键文件

| 路径 | 角色 |
|------|------|
| `server.js` | **整个后端** —— Express 5、WebSocket（/cmd/）、node-pty 创建子进程 |
| `public/index.html` | **整个前端** —— 内联 JS、xterm.js v6、无打包工具 |
| `config.json` | 运行时持久化配置（rows、cols、hotkeys、scrollInterval、maxBuffer、maxFrontendLogs、clientTailMax） |
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
4. **缓冲区上限由 `config.json` 的 `maxBuffer` 控制**（默认 10 MB，1 MB = 1,000,000 字符），在设置弹窗内输入并实时同步所有客户端。服务端用模块级 `maxBufferChars` 缓存；`onData` 中用滞回式截断（超 2x 触发 slice）。`loadConfig` 自动迁移旧字符数格式（值 ≥ 1000 时视为字符，自动转 MB 并落盘）。
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
16. **buffer 自动检测**：弹窗打开时即调用 `queryBufferSize()` 拉取当前会话占用（`{type:'buffer_size', id}` → 服务端回 `{type:'buffer_size', id, used, max}`，字符数）。前端用 `/ 1000000` 转 MB，显示为 `当前会话占用: X.XX MB / Y.YY MB (Z.Z%)`。`#bufferSizeResult` 文本依次经历 `检测中...` → 真实占用或 `当前无活动会话` / `检测超时`（5s 兜底）。无活动会话时 `queryBufferSize()` 直接显示「当前无活动会话」并 return，不发请求。
17. **2026-06-30 过度设计审查结论**：发现 3 处过度设计 / 冗余，**均已修复**：
    1. `public/index.html` 中 4 个 hidden input（`rowsInput/colsInput/scrollStepInput/maxBufferInput`）用 DOM 当 state 容器 → 改为 JS 顶层变量（`let rows = null, cols = null`；`scrollStep/maxBuffer` 原本就同时是 JS 变量，删除 DOM 那份）。`createTermInstance` 用 `Number.isInteger(rows) && Number.isInteger(cols)` 守卫跳过初始 resize（与旧版 hidden input 空 value 行为一致）。
    2. `syncLayoutWidths` 函数 4 个触发点中 `window resize` 是冗余（`#terminal-container { align-self: flex-start }` 不随窗口缩放变化） → 删除 `window.resize` 监听，保留 `DOMContentLoaded` + `ResizeObserver` 两个有效触发点。
    3. `updateWsStatus` 1Hz 轮询 → 改事件驱动。`ws.onopen / onerror / onclose` 三事件触发 `updateWsStatus()`。**重连策略**：
       - `ws.onclose` 内检查 `navigator.onLine`：在线则 `setTimeout(connect, 1000)` 延迟重试；离线则不安排定时器，等 `online` 事件
       - `window.addEventListener('online', connect)`：浏览器报告网络恢复时立即重连
       - `reconnectTimer` 变量 + `clearTimeout`：`connect()` 开头清理上一个待执行的重连定时器
       - **用户测试发现并修复（2026-06-30）**：最初 `connect()` 函数开头有 `if (!navigator.onLine) return` 守卫，导致 `onclose` 设置的定时器在 1 秒后触发时若仍离线就直接 return 且不安排后续重试，形成"悬空"状态。修复方式：将 `navigator.onLine` 判断从 `connect()` 移到 `ws.onclose` 中，由 `onclose` 决定是安排 backoff 还是等待 `online` 事件，`connect()` 只负责建立连接。
    - **已知风险**：移动端"沉默死亡"（TCP 连接被 NAT 清掉但浏览器不感知）场景下，UI 显示"已连接"但实际断了。**当前能覆盖**：飞行模式/无 WiFi 等明确离线状态（`navigator.onLine` 变 false → 不重试；`online` 事件触发 → 立即重连）。**仍覆盖不到**：网络活着但 WS 连接被中间设备单方面清掉。遇到此情况手动 F5 刷新。
    
    其他 8 个候选点（`min-width: 60px` 移动端点击区域、`availableKeys` 手机点选、`computeSmartName` 命名连贯、70 行 `.modal-box` CSS、3 个独立"应用"按钮、`maxBufferChars` 缓存等）经用户确认均为合理设计或可选优化，**不在本次范围**。完整审查记录见 [docs/superpowers/specs/2026-06-30-over-engineering-audit-design.md](docs/superpowers/specs/2026-06-30-over-engineering-audit-design.md)。**新增/修改代码时如果引入新的 state 容器，优先用 JS 变量**，不再用 hidden input。

18. **滚动行数分离（2026-07-01 已移除 scrollStep）**：2026-06-30 引入 scrollStep 控制 ▲上滑终端/▼下滑终端的 SGR 滚轮事件发送次数。2026-07-01 完全移除 scrollStep，所有滚动按钮统一固定每次 1 行 + 按住滚动模式，设置弹窗中不再有"终端滚动行数"输入项。config.json 中的 scrollStep 字段已删除。

19. **PM2 进程管理 + 前端重启**：2026-06-30 引入。服务器由 PM2 管理（`pm2 start server.js --name remote-cmd`），`npm start` 启动。前端设置弹窗新增「重启服务器」按钮（`restartServer()`），发送 `{type:'restart_server'}` 到服务端。服务端回复确认后杀掉所有 PowerShell 子进程，200ms 后 `process.exit(1)` 退出，PM2 检测到非零退出码自动重启新实例。前端 `ws.onclose` 触发 1 秒后自动重连。**PM2 安装**：`npm install -g pm2`（一次性）。**常用命令**：`npm start`（启动）、`npm run restart`（重启）、`npm run stop`（停止）。**Trae 环境例外（2026-06-30）**：Trae PowerShell 工具下 PM2 daemon 反复 EPERM（Windows 命名管道权限），PM2 不可用。`server.js` 实际由独立的 node 守护进程（PID 101804）拉起，113036 是当前 remote-cmd 服务进程。`process.exit(1)` 后 101804 会自动重新 spawn 新的 server.js 实例，前端 ws.onclose 触发 1 秒后自动重连。**恢复 PM2 管理**：需在 Trae 外的 PowerShell 手动执行 `pm2 start server.js --name remote-cmd` + `pm2 save`，或在 `c:\Users\fmy3\.pm2` 不存在的全新环境下使用。

20. **buffer 尾部比对去重 + 增量推送 + 等待期间丢弃 data（2026-06-30 引入）**：解决多终端场景下 buffer 加载慢的问题。设计要点：
    - **`TermSession.clientTail` 实例字段**：每个终端最近 N 字节（默认 4096，可通过设置弹窗调整）的原始 data/buffer 合并流。`session.appendClientTail(chunk)` 累加 + 滞回式截断（超阈值时 `slice(-clientTailMax)`）。状态随 `Map<number, TermSession>` 生命周期自动管理，无需手动清理。
    - **buffer 请求带 `tail` 字段**：所有 buffer 请求（list 处理器中新建会话的 `requestBuffer()` 调用、`isFirstList` 重连交集分支）都通过 `session.requestBuffer()` 发出，自动带 `this.clientTail` 作为 tail。
    - **服务端三档响应**（[server.js L118-L148](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L118-L148)）：
      1. **档 1 未变更**：`buf.endsWith(tail)` 命中 → 回 `{type:'buffer', id, data:''}`（pos 缺席）。客户端跳过 reset + write。
      2. **档 2 增量推送**：`buf.lastIndexOf(tail) !== -1`（且不命中档 1）→ 回 `{type:'buffer', id, data: buf.slice(i + tail.length), pos: i + tail.length}`。客户端只 `term.write(data)` 追加。
      3. **档 3 全量**：tail 缺/空串/`lastIndexOf` 没找到 → 回 `{type:'buffer', id, data: buf.slice(-maxBufferChars) || buf}`。客户端 `term.reset() + term.write(data)`。
    - **`session.pendingBuffer: boolean` 实例字段**：客户端在 `requestBuffer()` 时置 true，`handleBufferResponse()` 内置 false。**等待期间到达的 data 消息直接丢弃**（list 处理器中 `if (s.pendingBuffer) return`）。原因：服务端 send buffer 响应时 `buf.slice(pos)` 已包含 send 那一刻之前的所有 PTY 数据，这些 data 内容已包含在 buffer 响应的 `data` 字段中，写入会导致重复。TCP 有序保证：send buffer 响应之后的 broadcast 一定在 buffer 响应之后到达客户端 → 后续 data 正常处理。这样不需要 `clientLengths` 字典、不需要 overlap 计算。
    - **`client_tail_max` 消息**：连接建立时下发（来自 config.json）；设置弹窗变更时客户端发 `{type:'client_tail_max', data}` → 服务端存盘 + 广播给所有客户端。收到时 `client_tail_max` 处理器遍历 sessions 调用 `s.trimClientTail(clientTailMax)` 立即按新阈值裁剪已有 clientTail。
    - **配置字段**：`config.json.clientTailMax`（默认 4096，范围 64-65536）。`loadConfig` 防御性默认：`if (cfg.clientTailMax == null) cfg.clientTailMax = 4096`，避免老用户 config.json 缺字段时 `undefined` 穿透。
    - **list 处理器新建会话时调 `requestBuffer()`**：`this.clientTail` 是空串 → 服务端 `buf.endsWith('') === true` → 档 1 命中 → 客户端跳过 reset + write。xterm 本身是空的，没有需要恢复的内容。
    - **list 处理器删除 term 时清理**：`s.dispose(); sessions.delete(id)`（`TermSession.dispose()` 内 `term.dispose(); wrapper.remove();`，`clientTail` / `pendingBuffer` 随 Map GC 清理，无需显式 delete）。

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

24. **按住滚动间隔可配置（2026-06-30）**：按住上滑/下滑按钮时连续触发的间隔毫秒数改为 config.json 可配置项。
    - 字段名：`scrollInterval`，默认 100ms，范围 1-1000ms
    - WebSocket 消息类型：`scroll_interval`（双向同步）
    - 前端 `setupHoldScroll` 每次 `setInterval` 触发时重新读取全局 `scrollInterval` 变量
    - 设置弹窗中「按住滚动间隔 (ms)」输入框，step=10，min=1

25. **前端日志上限可配置（2026-06-30）**：前端日志上限从硬编码 500 改为 config.json 可配置项。
    - 默认值 50（用户明确指定），范围 10-10000，step=10
    - 滞回式截断：`frontendLogs.length > maxFrontendLogs * 2` 时触发，截断到 `maxFrontendLogs` 条
    - 截断方式：`frontendLogs = frontendLogs.slice(-maxFrontendLogs)`
    - 完整链路：前端变量 → WebSocket `max_frontend_logs` 消息 → server.js 持久化到 config.json → 连接时同步所有客户端
    - `loadConfig` 兜底：非数字/超范围时回退到 50

26. **大/小尺寸切换 + 双槽位（2026-07-01 引入）**：顶栏 `#sizeToggleBtn` 按钮在 large/small 之间切换。设置弹窗分大/小两节，每节独立设置行/列。协议：`size_slots`（C→S 写槽 + S→C 全量广播）/ `current_size`（C→S 切换 + S→C 广播当前尺寸）。旧的 `resize` 消息整条删除（C→S 和 S→C 双向）。**应用 = 切换 + 写槽**：用户点"应用"发两条消息（先 `size_slots` 写槽，再 `current_size` 切尺寸）。**默认值**：large=60×120, small=24×80。**记忆**：服务端通过 `config.currentSize` 字段记忆上次切换结果，连接建立时下发。**校验**：服务端对 sizeMode/size 必须是 'large'/'small'，rows/cols 必须在 20-200 整数范围内，非法值拒收。`config.sizeSlots` 字段是对象，键为 'large'/'small'，值为 `{rows, cols}`。**`current_size` 处理器无"无变化跳过"**（2026-07-01 修复行数不生效 bug）：用户在大尺寸时修改大尺寸行数，size_slots 已更新槽位，但 size 名未变 —— 若早返回则 PTY 和 xterm 都不 resize，必须刷新浏览器才能看到。修复后 `current_size` 始终按最新槽位 resize PTY + 落盘 + 广播。前端的 `sizeSlots` 已由上一条 `size_slots` 广播更新，`current_size` 处理器用 `sizeSlots[currentSize]` resize xterm 时拿到新槽位 → xterm 即时刷新。

27. **前后端日志覆盖（2026-07-01 补全）**：所有 WebSocket 消息都有 `addFrontendLog` 记录（设置弹窗 → 日志 按钮可查看），**唯二例外**：`input`（C→S 键盘输入，每按键都记会产生大量噪音）和 `data`（S→C PTY 输出，每帧都记会产生大量噪音）。**接收侧 8 类**（2026-07-01 补全）：`size_slots`（'尺寸槽位已更新'）/ `current_size`（'当前尺寸切换为 大/小 (rows x cols)'）/ `hotkeys`（'快捷键配置已同步'）/ `scroll_interval`（'按住滚动间隔同步为 X ms'）/ `max_buffer`（'缓冲区上限同步为 X MB'）/ `max_frontend_logs`（'日志上限同步为 X 条'）/ `client_tail_max`（'buffer 去重比对长度同步为 X 字节'）/ `buffer_size`（'缓冲区占用: X.XX MB / Y.YY MB (Z.Z%)'）。**发送侧补 2 类**（2026-07-01 补全）：`buffer`（'开始拉取 XX 缓存'，在 `term-session.js#requestBuffer` 内）/ `hot_keys`（'快捷键已同步给服务端'，在 `syncHotkeys` 内）。**新增 wsSend 处理器时必须配套添加日志**，input/data 类高频消息除外。

28. **服务端权威 + 客户端不乐观更新（2026-07-01 修复）**：设置类 `apply*` 处理器**不应在 `wsSend` 之前修改本地状态**，否则 ws 失败时本地已变但服务器没变，下次重连被服务器覆盖 → "看似应用了" 实际没生效的不一致。**正确模式**：只 `wsSend`，本地状态由 `ws.onmessage` 收到 broadcast 后统一更新（接收侧已有 `xxx = msg.data` 赋值）。**已修复**：`applySettingsScrollInterval` / `applySettingsMaxBuffer` / `applySettingsMaxFrontendLogs` / `applySettingsClientTailMax` —— 删除 `scrollInterval = v` / `maxBuffer = v` / `maxFrontendLogs = v` / `clientTailMax = v; clientTailMax2 = v * 2` 4 处本地 mutation，删除对应发送侧 `addFrontendLog`（与接收侧 'X 同步为 Y' 重复）。**已是正确模式**（无需改）：`applySettingsSizeFor` / `toggleSize`（size 类只读 sizeSlots/currentSize 不修改）/ `renameCurrent` / `renameAll` / `createNew`（pendingCreate 是创建标志位非配置）/ `killCurrent`（本地 term 由 list 处理器统一删）/ `restartServer` / `syncHotkeys`（hotkeys 已在用户编辑时改）。**fbBtn 保持立即调用**："指令已发出"语义；wsSend 失败时 `wsSend` 内部 catch 会 log 失败原因。**新增 apply 类处理器时**：只发不发本地状态，本地状态由 `ws.onmessage` 接收侧负责更新。

## 开发工作流

- **只改前端时不要重启服务器**：测试前先用 `Get-NetTCPConnection -LocalPort 65433` 检查后端服务器是否在跑。如果在跑就直接连现成的服务器测网页（静态文件刷新即可加载新前端）。只有改了 `server.js` 时才需要重启服务。
- **PM2 重启纪律**：以后所有重启操作必须通过 PM2（`npm run restart` 或前端设置弹窗的「重启服务器」按钮），**禁止直接 taskkill / kill 进程**，否则会破坏 PM2 的进程管理状态。非 PM2 方式杀进程后，PM2 会误认为进程仍在管理下，导致 `pm2 restart` 失败。
- **每次代码改动必须附带性能影响分析**：在计划阶段或提交改动时，分析改动涉及的 DOM 操作量、事件监听器数量、布局/回流影响、内存开销、执行频率等关键指标。可忽略的影响也需明确说明理由。纯文档/注释/配置变更除外。

## 更新规则

- **每次修改需求或更新注意事项后，必须同步更新本文件。**
- **每次对本文件进行修改后，必须通知用户。**