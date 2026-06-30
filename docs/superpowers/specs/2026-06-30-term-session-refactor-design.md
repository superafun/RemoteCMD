# TermSession 封装重构设计

**日期**：2026-06-30
**类型**：refactor
**范围**：纯前端（`public/index.html`、新增 `public/term-session.js`），`server.js` / 协议不变
**配套基础设施**：项目首次纳入 git 版本控制（[AGENTS.md](../../AGENTS.md) Git 工作流章节）

## 1. 背景与目标

### 1.1 现状

`public/index.html` 用 4 个并行字典按 session id 索引状态：

| 字典 | 含义 |
|------|------|
| `terms[id]` | xterm Terminal 实例 |
| `wrappers[id]` | DOM 包装层 div |
| `clientTails[id]` | 字符串（buffer 去重尾部） |
| `names[id]` | 显示名 |

加 1 个 `Set`：`pendingBuffer`（等待 buffer 响应的 id 集合）。

### 1.2 问题

- **散点状态**：4 个字典 + 1 个 Set 共享同一个 key 空间，每加一个 per-session 字段就要新建一个字典、3 处清理点
- **典型表现**：`list` 处理器中 5 行 `delete` 块（terms / wrappers / clientTails / pendingBuffer / names 都要清）
- **可读性差**：`terms[id]` / `wrappers[id]` / `clientTails[id]` 反复出现，难以一眼看出这些是同一个会话的三个属性
- **`activeId` 散在多处**：跟 4 个字典通过字符串 key 隐式关联

### 1.3 目标

- 把 4 个字典 + 1 个 Set 合并为 `Map<number, TermSession>`，每个 session 自包含
- 抽出 `public/term-session.js` 单独文件，便于翻阅和修改
- 行为不变，纯重构

## 2. 总体方案

### 2.1 类设计

新增 `class TermSession`，封装单个终端会话的所有状态与行为。**所有 4 个并行字典的数据 + 相关行为搬入类内**。

外部存储：`const sessions = new Map()` 替代 4 个字典 + 1 个 Set。

### 2.2 文件拆分

```
public/
├── index.html          # 入口 + 内联 script（全局状态、消息处理器、弹窗、自由函数）
├── styles.css          # 新增：所有自定义 CSS（从 index.html 的 <style> 块迁出）
├── term-session.js     # 新增：TermSession 类定义
├── xterm/...           # 不存在（走 node_modules）
└── ...
```

`index.html` 头部引用顺序：

```html
<link rel="stylesheet" href="./xterm/css/xterm.css">  <!-- 已有 -->
<link rel="stylesheet" href="./styles.css">           <!-- 新增 -->
<script src="./xterm/lib/xterm.js"></script>
<script src="./addon-web-links/lib/addon-web-links.js"></script>
<script src="./addon-unicode11/lib/addon-unicode11.js"></script>
<script src="./term-session.js"></script>  <!-- 新增 -->
<script> /* 内联：状态 + 消息处理器 + 弹窗 + 自由函数 */ </script>
```

类的方法体引用 `wsSend` / `addFrontendLog` / `clientTailMax` / `scrollStep` / `rows` / `cols` 等全局变量 —— 类定义加载时方法体不执行，等 `new TermSession(...)` 被调用时（第 5 步内联脚本执行后）这些全局都已就绪。

### 2.3 全局状态变化

| 旧 | 新 |
|----|----|
| `const terms = {};` | **删除**（搬到 `session.term`） |
| `const wrappers = {};` | **删除**（搬到 `session.wrapper`） |
| `const clientTails = {};` | **删除**（搬到 `session.clientTail`） |
| `const pendingBuffer = new Set();` | **删除**（搬到 `session.pendingBuffer: boolean`） |
| `const names = {};` | **删除**（搬到 `session.name`） |
| `let activeId = null;` (string) | `let activeId = null;` (**number** \| null) |
| — | **新增** `const sessions = new Map();` |

`Map<number>` 选型：`msg.id` 已经是 number，去掉现在 `msg.ids.map(String)` 的强制转换；`activeId` 同步改为 number，`<select>.value` setter 自动转字符串。

## 3. TermSession 类设计

### 3.1 属性

| 名称 | 类型 | 说明 |
|------|------|------|
| `id` | `number` | 会话 ID |
| `name` | `string` | 显示名（默认 `'Shell #' + id`） |
| `term` | `Terminal` | xterm 实例 |
| `wrapper` | `HTMLDivElement` | DOM 包装层（`class="term-wrapper"`，初始 `display: none`） |
| `clientTail` | `string` | 尾部比对字符串 |
| `pendingBuffer` | `boolean` | 是否在等 buffer 响应 |

### 3.2 方法

| 分类 | 方法签名 | 说明 |
|------|----------|------|
| 生命周期 | `constructor(id, container)` | 创建 wrapper + term + addons + 绑定 `term.onData`；若 `rows/cols` 已就绪则 `term.resize(cols, rows)` |
| 生命周期 | `dispose()` | `this.term.dispose()` → `this.wrapper.remove()`（顺序固定，xterm 先解绑事件） |
| 写入 | `write(data, mode = 'append')` | `mode === 'reset'` 时先 `term.reset()`，然后 `term.write(data)` + `appendClientTail(data)` |
| Buffer 协议 | `requestBuffer()` | `pendingBuffer = true` → `wsSend({type:'buffer', id, tail: clientTail})` → `showBufferLoading()` |
| Buffer 协议 | `handleBufferResponse(msg)` | 处理 3 档响应并 `pendingBuffer = false` + `hideBufferLoading()`，返回 `'skip' \| 'incremental' \| 'full'` |
| 加载动画 | `showBufferLoading()` / `hideBufferLoading()` | 在 wrapper 内添加/移除 `.buffer-loading` div |
| 尾部维护 | `appendClientTail(chunk)` | 累加并按 `clientTailMax` 滞回式截断（超阈值时 `slice(-clientTailMax)`） |
| 尾部维护 | `trimClientTail(max)` | 阈值变更时调用，按新 `max` 裁剪 |
| 显示控制 | `show()` / `hide()` / `focus()` | 切换 `wrapper.style.display` + `term.focus()` |
| 滚动 | `scrollToBottom()` / `scrollLines(n)` | 透传 xterm API |
| 滚动 | `sendSgrWheel(dir)` | 计算 SGR 序列（`y = ceil(term.rows / 2)`，dir > 0 → 65 / 否则 64），循环 `scrollStep` 次 `wsSend({type:'input', id, data: seq})` |
| 尺寸 | `resize(cols, rows)` | 透传 `term.resize(cols, rows)` |

### 3.3 3 档响应处理

`handleBufferResponse(msg)` 内部逻辑：

```js
handleBufferResponse(msg) {
    this.pendingBuffer = false;
    this.hideBufferLoading();
    if (msg.data === '' && msg.pos == null) return 'skip';
    if (msg.pos != null) { this.write(msg.data); return 'incremental'; }
    if (msg.data)        { this.write(msg.data, 'reset'); return 'full'; }
}
```

对应调用：

| 档 | 服务端条件 | 前端行为 | 返回值 |
|----|----------|---------|--------|
| 1 | `buf.endsWith(tail)` | 不调用 `write` | `'skip'` |
| 2 | `buf.lastIndexOf(tail) !== -1` | `write(data)` (append) | `'incremental'` |
| 3 | tail 缺/空串/未找到 | `write(data, 'reset')` | `'full'` |

### 3.4 类内不持有（保持全局）

- `wsSend` 函数（直接调用，避免 DI 样板；与 `parseHotkey` / `addFrontendLog` 等自由函数调用风格一致）
- `clientTailMax` / `scrollStep` / `rows` / `cols` / `maxFrontendLogs` 等配置（通过方法参数传入）
- 前端日志 `addFrontendLog`（会话内 3 处调用 + 外部 10+ 处调用，统一调全局函数，避免两条日志路径）

## 4. 集成变更

### 4.1 4 个消息处理器

**list**：

```js
if (msg.type === 'list') {
    if (msg.names) {
        Object.entries(msg.names).forEach(([id, name]) => {
            const s = sessions.get(+id);
            if (s) s.name = name;
        });
    }
    const currentIds = msg.ids;
    const oldIds = Array.from(sessions.keys());

    // 创建新会话
    currentIds.forEach(id => {
        if (!sessions.has(id)) {
            const s = new TermSession(id, terminalContainer);
            s.name = msg.names?.[id] || ('Shell #' + id);
            sessions.set(id, s);
            addFrontendLog('新建终端' + s.name + '并申请缓存');
            s.requestBuffer();
            if (pendingCreate) { pendingCreate = false; switchSession(id); }
        }
    });

    // 删除已不存在的会话
    oldIds.forEach(id => {
        if (!currentIds.includes(id)) {
            const s = sessions.get(id);
            if (s) {
                addFrontendLog('删除终端' + s.name);
                s.dispose();
                sessions.delete(id);
            }
            if (activeId === id) activeId = null;
        }
    });

    // 重连后第一个 list：对 diff 交集发 buffer 请求
    if (isFirstList) {
        isFirstList = false;
        oldIds.forEach(id => {
            if (currentIds.includes(id)) {
                sessions.get(id).requestBuffer();
                addFrontendLog('申请已存在终端' + sessions.get(id).name + '的缓存');
            }
        });
    }

    // 当前会话被 kill 后跳到 ID 最大者
    if (activeId == null && currentIds.length > 0) {
        switchSession(currentIds.reduce((a, b) => a > b ? a : b));
    }

    renderSessionSelect();
}
```

**buffer / data / resize / client_tail_max**：

```js
else if (msg.type === 'buffer') {
    const s = sessions.get(msg.id);
    if (!s) return;
    const result = s.handleBufferResponse(msg);
    if (result === 'skip')            addFrontendLog('缓冲区无变化，跳过回放 (' + s.name + ')');
    else if (result === 'incremental') addFrontendLog(`缓冲区增量 ${msg.data.length} 字节 (${s.name})`);
    else if (result === 'full')       addFrontendLog(`缓冲区全量回放 ${msg.data.length} 字节 (${s.name})`);
}
else if (msg.type === 'data') {
    const s = sessions.get(msg.id);
    if (!s || s.pendingBuffer) return;  // 等待中丢弃
    s.write(msg.data);
}
else if (msg.type === 'resize') {
    rows = msg.data.rows; cols = msg.data.cols;
    sessions.forEach(s => s.resize(cols, rows));
}
else if (msg.type === 'client_tail_max') {
    clientTailMax = msg.data;
    sessions.forEach(s => s.trimClientTail(clientTailMax));
}
```

### 4.2 简化的自由函数

```js
function renderSessionSelect() {
    const sel = document.getElementById('sessionSelect');
    sel.innerHTML = '';
    sessions.forEach((s, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = s.name || ('Shell #' + id);
        if (id === activeId) opt.selected = true;
        sel.appendChild(opt);
    });
}

function switchSession(id) {
    const idNum = parseInt(id);  // 兼容 select.onchange 传 string
    if (activeId === idNum) return;
    if (activeId != null) sessions.get(activeId)?.hide();
    activeId = idNum;
    sessions.get(idNum)?.show();
    document.getElementById('sessionSelect').value = idNum;
    // 弹窗打开时同步「检测」按钮的可用性
    const queryBtn = document.getElementById('queryBufferSizeBtn');
    if (queryBtn) queryBtn.disabled = !activeId;
}

function killCurrent() {
    if (activeId == null) return;
    addFrontendLog('关闭终端 (' + (sessions.get(activeId)?.name || 'Shell #' + activeId) + ')');
    wsSend({ type: 'kill', id: activeId });
}

function renameCurrent() {
    if (activeId == null) return;
    const cur = sessions.get(activeId)?.name || ('Shell #' + activeId);
    const name = prompt('重命名当前会话', cur);
    if (name === null) return;
    wsSend({ type: 'rename', id: activeId, data: name });
    addFrontendLog('终端重命名: ' + (name.trim() || '(空)'));
}

function sendSgrWheel(dir) {
    const s = sessions.get(activeId);
    if (!s) return;
    s.sendSgrWheel(dir);
}

function scrollBottom()      { sessions.get(activeId)?.scrollToBottom(); }
function scrollXtermUp()    { sessions.get(activeId)?.scrollLines(-1); }
function scrollXtermDown()  { sessions.get(activeId)?.scrollLines(1); }
```

### 4.3 保留不变

- `createNew` / `parseHotkey` / `applySettings*` / `openHotkeyEditor` / 弹窗相关 / 滚动按钮 / `connect` / `updateWsStatus` / `frontendLogs` / `addFrontendLog` / `availableKeys` / `setupHoldScroll`
- 全局 state：`ws` / `hotkeys` / `pendingCreate` / `isFirstList` / `reconnectTimer` / `editorDiv` / `editingKey` / `settingsDiv` / `scrollStep` / `scrollInterval` / `maxBuffer` / `maxFrontendLogs` / `clientTailMax` / `rows` / `cols`
- DOM 容器：`const terminalContainer = document.getElementById('terminal-container');`（提到模块级，类构造时传入）

## 5. 迁移计划

### 5.1 Commit 划分（2 个 commit）

**Commit 1：新增文件 + 加载（零行为变更）**

1. 新建 `public/term-session.js`，写入完整 `TermSession` 类定义
2. 新建 `public/styles.css`，把 `public/index.html` 的 `<style>` 块内全部内容迁出
3. `public/index.html` 头部加 `<link rel="stylesheet" href="./styles.css">` 与 `<script src="./term-session.js"></script>`（在 xterm 之后、内联 script 之前），删除原 `<style>` 块
4. 验证：F5 刷新页面，DevTools console 输入 `TermSession` 应能查到类，页面样式无变化

**Commit 2：替换使用（一次性切换）**

1. 删旧：`const terms = {};` / `const wrappers = {};` / `const clientTails = {};` / `const pendingBuffer = new Set();` / `const names = {};`
2. 加新：`const sessions = new Map();` / `let activeId = null;`（number 类型）
3. 提模块级：`const terminalContainer = document.getElementById('terminal-container');`
4. 重写 `list` / `buffer` / `data` / `resize` / `client_tail_max` 5 个处理器
5. 重写 `switchSession` / `killCurrent` / `renameCurrent` / `sendSgrWheel` / `scrollBottom` / `scrollXtermUp` / `scrollXtermDown`
6. 抽 `renderSessionSelect()` 出来
7. 删 `createTermInstance`（合并进 `TermSession` 构造 + list 处理器）

### 5.2 测试清单（手动）

| # | 场景 | 期望 |
|---|------|------|
| 1 | 首次打开页面 | 自动创建一个会话，xterm 显示 PowerShell 提示符 |
| 2 | 输入命令（`Get-Date`） | 输出回显到当前 xterm |
| 3 | 「新建终端」 | 新会话出现并自动切换，可立即输入 |
| 4 | 下拉框切换会话 | wrapper show/hide 正确，焦点切到目标 xterm |
| 5 | 「关闭终端」 | 当前会话消失，焦点跳到 ID 最大的剩余会话 |
| 6 | 后端 `npm run restart` | 前端 1 秒后重连，list 消息带回原会话，buffer 走 3 档响应（日志区分 skip / incremental / full） |
| 7 | 「重命名」 | 下拉框文本更新 |
| 8 | 「重命名全部」 | 所有会话按 `computeSmartName` 重命名 |
| 9 | 设置弹窗改 rows/cols | 所有 xterm 同步 resize，`.toolbar` / `#hotkeys-bar` 宽度跟随 |
| 10 | 设置弹窗改 buffer 去重长度 | 旧 clientTail 立即被裁剪 |
| 11 | 设置弹窗「重启服务器」 | 所有会话被服务端清空，前端 1 秒后重连，新会话自动创建 |
| 12 | 设置弹窗「日志」 | 日志内容正确（含 session 名 + 缓冲区状态） |
| 13 | 「▲上滑终端 / ▼下滑终端」按住 | 按 `scrollInterval` 周期发送 SGR 滚轮事件 |
| 14 | 「▲上滑页面 / ▼下滑页面 / ▽到底页面」 | xterm 视口滚动 1 行 / 到底 |
| 15 | 快捷键按钮 | 点击发送对应转义序列 |
| 16 | 快捷键编辑器 | 添加 / 编辑 / 删除 / 上移 均正常 |
| 17 | 多客户端（两个标签） | 任一端创建/删除/重命名会话，另一端 list 消息后同步 |
| 18 | 移动端（Chrome DevTools 模拟） | 按钮可点击，终端可滚动 |

## 6. 风险与回退

| # | 风险 | 缓解 |
|---|------|------|
| 1 | **`activeId` 类型 string → number**：`select.onchange` 回调传 string | `switchSession(id)` 内部 `parseInt(id)` 统一入口；其余位置用 `===` 跟 number 比较 |
| 2 | **`msg.ids.map(String)` 移除**：`currentIds.includes(id)` 类型不一致 | `msg.ids` 本身就是 number，`Array.from(sessions.keys())` 也是 number，无需转换 |
| 3 | **Map `forEach` 参数顺序 `(value, key)`**：与 `Object.entries().forEach(([key, value]))` 相反 | 仅影响 `sessions.forEach((s, id) => ...)`，用解构别写反 |
| 4 | **构造时 `wsSend` 静默失败**：`ws.readyState !== 1` 时 `wsSend` return 静默 | 当前 `createTermInstance` 也有同样问题（list 消息必然在 WS 打开后到达），非回归 |
| 5 | **`dispose()` 顺序**：`term.dispose()` 必须在 `wrapper.remove()` 之前 | 类内 `dispose()` 顺序固定为 `this.term.dispose(); this.wrapper.remove();` |
| 6 | **`Number.isInteger(rows) && Number.isInteger(cols)` 守卫**：构造时 `rows/cols` 还未到时跳过 resize | 保留原守卫；服务端 resize 消息到达时统一 `sessions.forEach(s => s.resize(...))` |
| 7 | **`isFirstList` 重连分支重复 `requestBuffer`**：旧会话刚断开时的尾巴可能在服务端已过期 | 走 3 档响应逻辑（`endsWith` / `lastIndexOf` / 全量），与服务端协议无变化 |
| 8 | **Map 查不到返回 `undefined`**：所有 `sessions.get(msg.id)` 都要加 `if (!s) return;` 守卫 | 已在 buffer / data 处理器中加；resize / client_tail_max 用 `forEach` 天然安全 |
| 9 | **服务端协议不变**：纯前端重构 | `server.js` 不动；只需 `Get-NetTCPConnection -LocalPort 65433` 确认后端在跑，刷新页面即可测 |

### 回退方案

- Commit 1 出问题：删 `<script src="./term-session.js">` + 删 `<link rel="stylesheet" href="./styles.css">` + 删 `public/term-session.js` + 删 `public/styles.css` + 把 `<style>` 块粘回 `public/index.html`，回到当前状态
- Commit 2 出问题：`git revert HEAD` 撤销最近 commit
- 重大问题：`git revert <sha1>..<sha2>` 撤销连续多个 commit

## 7. 关联文档

- [AGENTS.md Git 工作流章节](../../AGENTS.md) — commit 信息规范、回退纪律
- [2026-06-30-over-engineering-audit-design.md](./2026-06-30-over-engineering-audit-design.md) — 历史精简审查
- [2026-06-30-buffer-tail-dedup-design.md](./2026-06-30-buffer-tail-dedup-design.md) — 3 档 buffer 响应协议
- [2026-06-29-reconnect-buffer-replay-design.md](./2026-06-29-reconnect-buffer-replay-design.md) — 重连后 buffer 拉取
