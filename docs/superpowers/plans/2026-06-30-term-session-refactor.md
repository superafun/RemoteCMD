# TermSession 封装重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 4 个并行字典（`terms` / `wrappers` / `clientTails` / `names`）+ 1 个 `pendingBuffer` Set 合并为 `Map<number, TermSession>`，每个终端会话封装为独立类；同时把内联 CSS 与类代码各自抽到独立文件。

**Architecture:**
- 新增 `public/term-session.js` —— 包含 `class TermSession`，封装单个会话的所有状态（`term` / `wrapper` / `clientTail` / `pendingBuffer` / `name`）与行为（`write` / `requestBuffer` / `handleBufferResponse` / `show` / `hide` / `dispose` 等）
- 新增 `public/styles.css` —— 从 `public/index.html` 的 `<style>` 块迁出所有自定义 CSS
- `public/index.html` —— 删 4 个字典 + 1 个 Set，引入 `const sessions = new Map()`；消息处理器（`list` / `buffer` / `data` / `resize` / `client_tail_max`）改为操作 session 对象；`switchSession` / `killCurrent` / `renameCurrent` / `sendSgrWheel` / 滚动函数同步改造

**Tech Stack:** Node.js + node-pty + ws（后端不变）；xterm.js v6 + 原生 JS（前端重构）；PM2 进程管理；git 版本控制。

**关联设计文档**：[docs/superpowers/specs/2026-06-30-term-session-refactor-design.md](../specs/2026-06-30-term-session-refactor-design.md)

**项目约束**（来自 [AGENTS.md](../../AGENTS.md)）：
- 无测试框架、无 linter、无 formatter
- 单 `main` 分支（2026-06-30 起纳入 git）
- 端口 65433 硬编码
- 配置文件：`config.json`
- 客户端→服务端的 hotkey type 是 `hot_keys`（下划线）
- **前端-only 重构**：`server.js` 不动，WebSocket 协议不变；测试前用 `Get-NetTCPConnection -LocalPort 65433` 确认后端在跑，刷新页面即可
- 提交信息规范：`<前缀>: <一句话描述>`，Conventional Commits 风格（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`）
- 禁止 `git add -A`；单步回退用 `git revert HEAD`，禁止 `git reset --hard` 撤销已超过 1 个 commit 的历史

**改动文件**：

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [public/term-session.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/term-session.js) | 新建 ~120 行 | `class TermSession` 定义 |
| [public/styles.css](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css) | 新建 ~180 行 | 从 `public/index.html` 迁出所有 CSS |
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | -25 行 / +80 行 / 改 12 处 | 头部加载新文件 + 删 4 dicts + 引入 Map + 5 个处理器 + 7 个自由函数重写 |

---

## 阶段划分

本计划分 2 个 commit：

- **Commit 1：基础设施就绪（零行为变更）** —— Task 1-3
- **Commit 2：状态 + 行为重构（行为不变）** —— Task 4-14

每个 Task 含若干 Step（每个 Step 2-5 分钟动作）。

---

## Commit 1：基础设施就绪（零行为变更）

### Task 1: 新建 public/term-session.js（含 TermSession 类定义）

**Files:**
- Create: `public/term-session.js`

- [ ] **Step 1.1: 写入完整的 TermSession 类**

新建文件 `public/term-session.js`，写入以下内容（**注意：所有方法内调用的 `wsSend` / `addFrontendLog` / `clientTailMax` / `scrollStep` / `rows` / `cols` 是内联 script 中定义的全局变量，类文件加载时不执行方法体，只在 `new TermSession(...)` 被调用时执行**）：

```js
// public/term-session.js
// 封装单个终端会话的所有状态与行为。
// 依赖全局：Terminal, WebLinksAddon, Unicode11Addon,
//          wsSend, clientTailMax, scrollStep, rows, cols
class TermSession {
    // === 状态 ===
    id;            // number
    name;          // string
    term;          // Terminal
    wrapper;       // HTMLDivElement
    clientTail;    // string
    pendingBuffer; // boolean

    constructor(id, container) {
        this.id = id;
        this.name = 'Shell #' + id;
        this.clientTail = '';
        this.pendingBuffer = false;

        // 创建 DOM 包装层
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'term-wrapper';
        this.wrapper.style.display = 'none'; // 默认隐藏；创建者由 switchSession 翻成 block
        container.appendChild(this.wrapper);

        // 创建 xterm
        this.term = new Terminal({ allowProposedApi: true });
        this.term.open(this.wrapper);
        this.term.loadAddon(new WebLinksAddon.WebLinksAddon());
        this.term.loadAddon(new Unicode11Addon.Unicode11Addon());
        this.term.unicode.activeVersion = '11';

        // 输入转发到服务端
        this.term.onData(data => {
            wsSend({ type: 'input', id: this.id, data: data });
        });

        // 若 rows/cols 已就绪则立即 resize
        if (Number.isInteger(rows) && Number.isInteger(cols)) {
            this.term.resize(cols, rows);
        }
    }

    // === 生命周期 ===
    dispose() {
        // 顺序固定：xterm 先解绑事件，再移除 wrapper
        this.term.dispose();
        this.wrapper.remove();
    }

    // === 写入 ===
    // mode 缺省 'append'，'reset' 时先 reset 再 write
    write(data, mode = 'append') {
        if (mode === 'reset') this.term.reset();
        this.term.write(data);
        this.appendClientTail(data);
    }

    // === Buffer 协议 ===
    requestBuffer() {
        this.pendingBuffer = true;
        wsSend({ type: 'buffer', id: this.id, tail: this.clientTail });
        this.showBufferLoading();
    }

    handleBufferResponse(msg) {
        this.pendingBuffer = false;
        this.hideBufferLoading();
        if (msg.data === '' && msg.pos == null) return 'skip';
        if (msg.pos != null) { this.write(msg.data); return 'incremental'; }
        if (msg.data)        { this.write(msg.data, 'reset'); return 'full'; }
    }

    // === 加载动画 ===
    showBufferLoading() {
        if (this.wrapper.querySelector('.buffer-loading')) return;
        const div = document.createElement('div');
        div.className = 'buffer-loading';
        this.wrapper.appendChild(div);
    }

    hideBufferLoading() {
        const el = this.wrapper.querySelector('.buffer-loading');
        if (el) el.remove();
    }

    // === 尾部维护 ===
    appendClientTail(chunk) {
        if (!chunk) return;
        let buf = this.clientTail + chunk;
        if (buf.length > clientTailMax) buf = buf.slice(-clientTailMax);
        this.clientTail = buf;
    }

    trimClientTail(max) {
        if (this.clientTail.length > max) {
            this.clientTail = this.clientTail.slice(-max);
        }
    }

    // === 显示控制 ===
    show() {
        this.wrapper.style.display = 'block';
        this.term.focus();
    }

    hide() {
        this.wrapper.style.display = 'none';
    }

    focus() {
        this.term.focus();
    }

    // === 滚动 ===
    scrollToBottom() { this.term.scrollToBottom(); }
    scrollLines(n)   { this.term.scrollLines(n); }

    sendSgrWheel(dir) {
        const y = Math.ceil(this.term.rows / 2);
        const code = dir > 0 ? 65 : 64;
        const seq = '\x1b[<' + code + ';' + y + ';1M';
        for (let i = 0; i < scrollStep; i++) {
            wsSend({ type: 'input', id: this.id, data: seq });
        }
    }

    // === 尺寸 ===
    resize(cols, rows) {
        this.term.resize(cols, rows);
    }
}
```

- [ ] **Step 1.2: 验证语法**

打开终端执行：

```bash
node -c public/term-session.js && echo "OK"
```

期望输出：`OK`。如果报错，按提示修正语法。

- [ ] **Step 1.3: 提交**

```bash
git add public/term-session.js
git commit -m "feat: 新增 TermSession 类

封装单个终端会话的所有状态（term / wrapper / clientTail / pendingBuffer / name）
与行为（write / requestBuffer / handleBufferResponse / dispose 等）。
本 commit 仅新增类文件，不修改 index.html，类暂未被使用。"
```

---

### Task 2: 新建 public/styles.css（CSS 迁出）

**Files:**
- Create: `public/styles.css`

- [ ] **Step 2.1: 从 index.html 提取 CSS**

打开 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html)，定位第 10-189 行（`<style>` ... `</style>` 块内全部内容），完整复制。

- [ ] **Step 2.2: 创建 styles.css**

新建文件 `public/styles.css`，把 Step 2.1 复制的内容**原样粘贴**（包括所有注释和空行）。文件首尾不加任何额外内容。

- [ ] **Step 2.3: 验证 CSS 内容完整**

执行：

```bash
# 提取 index.html 旧 <style> 块内容到临时文件，手动核对行数
# （Windows PowerShell 等价命令）
```

简单核对方法：浏览器打开页面，DevTools → Elements → 选中 `<html>` 节点，看 Styles 面板是否有项目自定义的 `html { overflow-x: auto; }` 等规则出现（即使未引用也无所谓，先确认 CSS 内容已就位）。

- [ ] **Step 2.4: 提交**

```bash
git add public/styles.css
git commit -m "refactor: 新建 public/styles.css（CSS 迁出）

本 commit 仅新增空文件占位（后续 commit 才删除 index.html 的内联 <style>）。
为方便 review 分两步走，本 commit 不修改 index.html。"
```

> **注意**：此 commit 与 Task 3 的 commit 是配对的。Task 3 才把 `<link>` 引用加到 index.html 并删除内联 `<style>`。分两个 commit 是为了让 diff 更易 review。

---

### Task 3: 更新 public/index.html 加载新文件 + 删除内联 <style>

**Files:**
- Modify: [public/index.html:7-9](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L7-L9) — 头部 `<link>` + `<script>` 区
- Modify: [public/index.html:10-189](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L10-L189) — 删除整个 `<style>` 块

- [ ] **Step 3.1: 添加 styles.css 引用**

定位到 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 7 行：

```html
    <link rel="stylesheet" href="./xterm/css/xterm.css">
```

在其后新增一行：

```html
    <link rel="stylesheet" href="./styles.css">
```

- [ ] **Step 3.2: 添加 term-session.js 引用**

定位到第 9 行（`<script src="./addon-unicode11/lib/addon-unicode11.js"></script>` 之后、`<style>` 块之前），新增一行：

```html
    <script src="./term-session.js"></script>
```

> 该行位于 `<style>` 块之后 / 内联 `<script>` 块之前。具体位置不影响加载顺序，因为浏览器按文档顺序解析。

- [ ] **Step 3.3: 删除整个内联 <style> 块**

定位从 `<style>` 起始到 `</style>` 结束（第 10-189 行附近），整块删除。

完成后 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 头部结构应类似：

```html
    <link rel="stylesheet" href="./xterm/css/xterm.css">
    <link rel="stylesheet" href="./styles.css">
    <script src="./addon-web-links/lib/addon-web-links.js"></script>
    <script src="./addon-unicode11/lib/addon-unicode11.js"></script>
    <script src="./term-session.js"></script>
    <style>...</style>  <!-- 已删除 -->
```

- [ ] **Step 3.4: 验证零行为变更**

启动/确认后端在跑：

```bash
Get-NetTCPConnection -LocalPort 65433
```

期望：看到 LISTENING 状态的连接。如果没看到，执行 `npm start`。

浏览器访问 `http://localhost:65433/` ，逐项验证：

1. 页面正常打开，PowerShell 提示符出现
2. 输入 `Get-Date` 回车，输出回显
3. 顶栏、设置弹窗、终端视觉与改动前**完全一致**（按钮、颜色、布局无变化）
4. DevTools console 输入 `TermSession` 回车，应返回类定义 `class TermSession { ... }`
5. DevTools console 输入 `document.querySelector('link[href="./styles.css"]')` 应返回 `<link>` 元素
6. DevTools console 输入 `document.querySelector('style')` 应返回 `null`（内联样式块已删除）

如果视觉有变化，核对 styles.css 内容是否完整复制了原 `<style>` 块。

- [ ] **Step 3.5: 提交**

```bash
git add public/index.html
git commit -m "refactor: 加载 public/styles.css 与 public/term-session.js

- 头部加 <link rel=\"stylesheet\" href=\"./styles.css\">
- 头部加 <script src=\"./term-session.js\">
- 删除内联 <style> 块
零行为变更验证通过（手动 F5 测试）。"
```

---

## Commit 2：状态 + 行为重构（行为不变）

### Task 4: 提模块级 terminalContainer

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — `<script>` 块顶部

- [ ] **Step 4.1: 添加模块级常量**

定位到 `<script>` 块起始（在 `let ws = null;` 之前或任意顶部位置），新增一行：

```js
        const terminalContainer = document.getElementById('terminal-container');
```

- [ ] **Step 4.2: 验证页面正常**

刷新页面，确认无 console 错误、PowerShell 提示符正常出现。

- [ ] **Step 4.3: 提交**

```bash
git add public/index.html
git commit -m "refactor: 提模块级 terminalContainer 常量

为后续 TermSession 构造时传入 container 做准备。"
```

---

### Task 5: 替换全局状态（删 4 dicts + 加 Map）

**Files:**
- Modify: [public/index.html:217-241](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L217-L241) — 全局状态声明区

- [ ] **Step 5.1: 替换状态声明**

定位到内联 `<script>` 块顶部附近的：

```js
        let ws = null;
        const terms = {};
        const wrappers = {};
        let activeId = null;
        const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
        let hotkeys = {};
        let scrollStep = 3;
        let scrollInterval = 100;
        let maxBuffer = 50000;
        // rows / cols 替代原 #rowsInput / #colsInput（2026-06-30 移除 hidden input）
        // 初始 null：服务端 resize 消息到达前不调用 term.resize
        let rows = null;
        let cols = null;
        let editorDiv = null;
        let editingKey = null;
        let names = {};
        // 标记"刚才那个 create 请求是不是本客户端发起的"，决定新终端是否自动切换
        let pendingCreate = false;
        let isFirstList = true;  // 重连后第一个 list 标志，用于触发 diff 交集的 buffer 增量拉取
        let clientTailMax = 4096;  // 默认值，config.json 加载后会覆盖
        // 每个终端最近收到的原始字节（data 消息 + buffer 消息合并），用于 buffer 去重
        const clientTails = {};
        // 等待 buffer 响应中的终端集合。发送 buffer 请求时把 id 加入，收到 buffer 响应时移除
        // 在等待期间收到的 data 消息被丢弃（避免与 buffer 响应的 data 重复）
        const pendingBuffer = new Set();
        let settingsDiv = null;  // 设置弹窗 DOM 句柄
        // === 前端日志 ===
        let maxFrontendLogs = 50;
        const frontendLogs = [];
```

替换为：

```js
        let ws = null;
        const sessions = new Map();  // number id → TermSession
        let activeId = null;         // number | null
        const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
        let hotkeys = {};
        let scrollStep = 3;
        let scrollInterval = 100;
        let maxBuffer = 50000;
        // rows / cols 替代原 #rowsInput / #colsInput（2026-06-30 移除 hidden input）
        // 初始 null：服务端 resize 消息到达前不调用 term.resize
        let rows = null;
        let cols = null;
        let editorDiv = null;
        let editingKey = null;
        // 标记"刚才那个 create 请求是不是本客户端发起的"，决定新终端是否自动切换
        let pendingCreate = false;
        let isFirstList = true;  // 重连后第一个 list 标志，用于触发 diff 交集的 buffer 增量拉取
        let clientTailMax = 4096;  // 默认值，config.json 加载后会覆盖
        let settingsDiv = null;  // 设置弹窗 DOM 句柄
        // === 前端日志 ===
        let maxFrontendLogs = 50;
        const frontendLogs = [];
```

> 删除了：`const terms = {};` / `const wrappers = {};` / `const names = {};` / `const clientTails = {};` / `const pendingBuffer = new Set();`
> 新增了：`const sessions = new Map();`

- [ ] **Step 5.2: 验证页面报错符合预期**

刷新页面。**预期**：页面报错（因为 `createTermInstance` 等还在用 `terms[id]` / `wrappers[id]` 等），DevTools console 会出现 `TypeError: Cannot read properties of undefined (reading 'style')` 之类的错误。**这正常**，下一步会逐个修复。

- [ ] **Step 5.3: 暂不提交**

> 此 Task 与 Task 6 配对：状态先换、下一步再换使用方。中间状态是临时的，最终 commit 在 Task 14 末尾统一提交（或逐 Task 提交，见各 Task 提示）。

**为减少 commit 数量、降低 review 成本，推荐把 Task 5-14 合并为单个 commit**。本计划在 Task 14 末尾给出统一 commit 命令。

如要逐 Task 提交：每个 Task 完成后单独 `git add public/index.html && git commit -m "refactor: ..."`。

---

### Task 6: 重写 list 处理器

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — `ws.onmessage` 中 `if (msg.type === 'list')` 分支

- [ ] **Step 6.1: 定位原 list 分支**

搜索 `if (msg.type === 'list')`，定位到 `else if (msg.type === 'buffer')` 之前的整个 list 处理代码块（约 50 行）。

- [ ] **Step 6.2: 替换 list 处理器**

用以下代码**完整替换**原 list 分支：

```js
                    if (msg.type === 'list') {
                        // 更新 names（如果服务端带了 msg.names）
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

                        // 重连后第一个 list：对 diff 交集（即双方都有的 term）发 buffer 请求
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

- [ ] **Step 6.3: 验证 list 分支不报错**

刷新页面。预期：原 `terms[id]` / `wrappers[id]` / `clientTails[id]` 相关错误消失，但 `switchSession` / `renderSessionSelect` / `createTermInstance` 还会报错（后续 Task 修）。

---

### Task 7: 重写 buffer 处理器

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — `else if (msg.type === 'buffer')` 分支

- [ ] **Step 7.1: 定位原 buffer 分支**

搜索 `else if (msg.type === 'buffer')`，定位到 `else if (msg.type === 'data')` 之前的整个 buffer 处理代码块。

- [ ] **Step 7.2: 替换 buffer 处理器**

用以下代码完整替换：

```js
                    else if (msg.type === 'buffer') {
                        const s = sessions.get(msg.id);
                        if (!s) return;
                        const result = s.handleBufferResponse(msg);
                        if (result === 'skip') {
                            addFrontendLog('缓冲区无变化，跳过回放 (' + s.name + ')');
                        } else if (result === 'incremental') {
                            addFrontendLog(`缓冲区增量 ${msg.data.length} 字节 (${s.name})`);
                        } else if (result === 'full') {
                            addFrontendLog(`缓冲区全量回放 ${msg.data.length} 字节 (${s.name})`);
                        }
                    }
```

---

### Task 8: 重写 data 处理器

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — `else if (msg.type === 'data')` 分支

- [ ] **Step 8.1: 定位原 data 分支**

搜索 `else if (msg.type === 'data')`，定位到下一个 `else if` 之前的整个 data 处理代码块。

- [ ] **Step 8.2: 替换 data 处理器**

用以下代码完整替换：

```js
                    else if (msg.type === 'data') {
                        const s = sessions.get(msg.id);
                        if (!s || s.pendingBuffer) return;  // 等待 buffer 响应中，丢弃
                        s.write(msg.data);
                    }
```

---

### Task 9: 重写 resize 与 client_tail_max 处理器

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — `msg.type === 'resize'` 与 `msg.type === 'client_tail_max'` 两个分支

- [ ] **Step 9.1: 替换 resize 处理器**

定位 `else if (msg.type === 'resize')` 分支，替换为：

```js
                    else if (msg.type === 'resize') {
                        rows = msg.data.rows;
                        cols = msg.data.cols;
                        sessions.forEach(s => s.resize(cols, rows));
                    }
```

- [ ] **Step 9.2: 替换 client_tail_max 处理器**

定位 `else if (msg.type === 'client_tail_max')` 分支（原代码用 `Object.keys(clientTails).forEach`），替换为：

```js
                    else if (msg.type === 'client_tail_max') {
                        clientTailMax = msg.data;
                        sessions.forEach(s => s.trimClientTail(clientTailMax));
                    }
```

---

### Task 10: 替换 helpers + 新增 renderSessionSelect

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — 删除 `showBufferLoading` / `hideBufferLoading` / `appendClientTail` / `requestBuffer` 四个自由函数（已被 TermSession 取代）

- [ ] **Step 10.1: 删除已搬迁的自由函数**

删除以下 4 个函数（整个函数体）：

- `showBufferLoading(id)`
- `hideBufferLoading(id)`
- `appendClientTail(id, chunk)`
- `requestBuffer(id)`

> 它们的方法版本已搬入 TermSession 类。

- [ ] **Step 10.2: 重写 switchSession**

定位 `function switchSession(id)`，完整替换为：

```js
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
```

- [ ] **Step 10.3: 新增 renderSessionSelect**

在 `switchSession` 上方（或其他合适位置）新增函数：

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
```

---

### Task 11: 重写 killCurrent 与 renameCurrent

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — 两个函数

- [ ] **Step 11.1: 替换 killCurrent**

定位 `function killCurrent()`，完整替换为：

```js
        function killCurrent() {
            if (activeId == null) return;
            addFrontendLog('关闭终端 (' + (sessions.get(activeId)?.name || 'Shell #' + activeId) + ')');
            wsSend({ type: 'kill', id: activeId });
        }
```

- [ ] **Step 11.2: 替换 renameCurrent**

定位 `function renameCurrent()`，完整替换为：

```js
        function renameCurrent() {
            if (activeId == null) return;
            const cur = sessions.get(activeId)?.name || ('Shell #' + activeId);
            const name = prompt('重命名当前会话', cur);
            if (name === null) return;
            wsSend({ type: 'rename', id: activeId, data: name });
            addFrontendLog('终端重命名: ' + (name.trim() || '(空)'));
        }
```

---

### Task 12: 重写 sendSgrWheel 与滚动系列函数

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — 5 个函数

- [ ] **Step 12.1: 替换 sendSgrWheel**

定位 `function sendSgrWheel(dir)`，完整替换为：

```js
        function sendSgrWheel(dir) {
            const s = sessions.get(activeId);
            if (!s) return;
            s.sendSgrWheel(dir);
        }
```

- [ ] **Step 12.2: 替换 scrollBottom / scrollXtermUp / scrollXtermDown**

定位以下 3 个函数（每个 1 行），逐个替换：

- `function scrollBottom() { if (terms[activeId]) terms[activeId].scrollToBottom(); }` → `function scrollBottom() { sessions.get(activeId)?.scrollToBottom(); }`
- `function scrollXtermUp() { if (terms[activeId]) terms[activeId].scrollLines(-1); }` → `function scrollXtermUp() { sessions.get(activeId)?.scrollLines(-1); }`
- `function scrollXtermDown() { if (terms[activeId]) terms[activeId].scrollLines(1); }` → `function scrollXtermDown() { sessions.get(activeId)?.scrollLines(1); }`

---

### Task 13: 删除 createTermInstance

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — 删 `function createTermInstance(id) { ... }` 整段

- [ ] **Step 13.1: 定位并删除**

搜索 `function createTermInstance(id)`，删除整个函数（约 30 行）。`switchSession` 调用顺序与 `pendingCreate` 处理已迁入 Task 6 的 list 处理器。

- [ ] **Step 13.2: 验证无残留引用**

执行：

```bash
git grep -nE "terms\[|wrappers\[|clientTails\[|pendingBuffer|\\bterms\\b|\\bwrappers\\b|\\bclientTails\\b|\\bnames\\b" public/index.html
```

期望：无输出（除了可能的注释中提及术语「terms/wrappers/etc」的地方）。如果还有遗留，定位并清理。

> 注意：`activeId` 是新代码仍使用的全局变量，不在清除范围内。

---

### Task 14: 端到端手动测试 + 提交

**Files:**
- Modify: 无（仅验证 + 提交）

- [ ] **Step 14.1: 浏览器手动测试（按设计文档 5.2 测试清单）**

启动/确认后端在跑：

```bash
Get-NetTCPConnection -LocalPort 65433
```

刷新 `http://localhost:65433/`，逐项验证（详见设计文档 5.2 节）：

| # | 场景 | 期望 |
|---|------|------|
| 1 | 首次打开页面 | 自动创建一个会话，xterm 显示 PowerShell 提示符 |
| 2 | 输入命令（`Get-Date`） | 输出回显到当前 xterm |
| 3 | 「新建终端」 | 新会话出现并自动切换 |
| 4 | 下拉框切换会话 | wrapper show/hide 正确，焦点切到目标 xterm |
| 5 | 「关闭终端」 | 当前会话消失，焦点跳到 ID 最大的剩余会话 |
| 6 | 后端 `npm run restart` | 前端 1 秒后重连，buffer 走 3 档响应（日志区分 skip/incremental/full） |
| 7 | 「重命名」 | 下拉框文本更新 |
| 8 | 「重命名全部」 | 所有会话按 `computeSmartName` 重命名 |
| 9 | 设置弹窗改 rows/cols | 所有 xterm 同步 resize，`.toolbar` / `#hotkeys-bar` 宽度跟随 |
| 10 | 设置弹窗改 buffer 去重长度 | 旧 clientTail 立即被裁剪（dev console 验证：调小后再调大，无报错） |
| 11 | 设置弹窗「重启服务器」 | 所有会话被服务端清空，前端 1 秒后重连 |
| 12 | 设置弹窗「日志」 | 日志内容正确（含 session 名 + 缓冲区状态） |
| 13 | 「▲上滑终端 / ▼下滑终端」按住 | 按 `scrollInterval` 周期发送 SGR 滚轮事件 |
| 14 | 「▲上滑页面 / ▼下滑页面 / ▽到底页面」 | xterm 视口滚动 1 行 / 到底 |
| 15 | 快捷键按钮 | 点击发送对应转义序列 |
| 16 | 快捷键编辑器 | 添加 / 编辑 / 删除 / 上移 均正常 |
| 17 | 多客户端（两个标签） | 任一端创建/删除/重命名，另一端 list 消息后同步 |
| 18 | 移动端（Chrome DevTools 模拟） | 按钮可点击，终端可滚动 |

每项必须通过。如失败，定位修复（最常见原因：遗漏 `?.` 守卫、Map key 类型不匹配、`activeId` 类型未统一为 number）。

- [ ] **Step 14.2: 提交**

```bash
git add public/index.html
git commit -m "refactor: 4 个并行字典合并为 Map<number, TermSession>

- 删 const terms/wrappers/clientTails/names + pendingBuffer Set
- 引入 const sessions = new Map(); let activeId = null; (number)
- 5 个消息处理器（list/buffer/data/resize/client_tail_max）改为操作 session 对象
- 7 个自由函数（switchSession/killCurrent/renameCurrent/sendSgrWheel/3 个 scroll）改造
- 新增 renderSessionSelect() 辅助函数
- 删除 createTermInstance()（逻辑合并入 list 处理器）
- 18 项端到端手动测试通过"
```

---

## 完成后验证

```bash
git log --oneline -5
```

期望看到：

```
<新 sha> refactor: 4 个并行字典合并为 Map<number, TermSession>
<新 sha> refactor: 加载 public/styles.css 与 public/term-session.js
<新 sha> refactor: 新建 public/styles.css（CSS 迁出）
<新 sha> feat: 新增 TermSession 类
aea4351 docs: 添加 TermSession 封装重构设计文档
... （更早的 commits）
```

## 回退

- 单步回退：`git revert HEAD`（回到上一 commit 状态）
- 跳到 Commit 1 之前：`git revert <commit2-sha>..<commit5-sha>`（一次性撤销 4 个 refactor commits）
- 紧急回退到重构前（commit aea4351 状态）：`git revert <commit5-sha>..<commit6-sha>`（撤销所有新增 commit）

## 后续可选优化（不在本计划范围）

- 抽 `wsSend` / `addFrontendLog` / `frontendLogs` 到独立 Logger 模块（与 TermSession 解耦）
- 进一步拆分 `public/index.html` 内联 script（按弹窗 / 热键 / 设置 分文件）
- 给 TermSession 写单元测试（需先引入 vitest / jest）
