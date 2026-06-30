# 重连后 Buffer 增量拉取实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复前端 WebSocket 重连后"终端卡住"bug：重连后第一个 `list` 消息到达时，对客户端与服务器**都有的 term**（diff 交集）自动发 buffer 请求，把断网期间错过的内容补回；常规 session create/kill 的 list 不受影响。

**Architecture:** 纯前端单文件改动。在 `ws.onopen` 中重置 `isFirstList = true` 标志；list 处理器在 diff 完成后检查该标志，对 diff 交集（`currentIds ∩ oldTermIds`）发 `{type:'buffer'}` 请求。`createTermInstance` 内的既有 buffer 请求保持不变（按职责对称："createTermInstance 创建 xterm 就该负责把它填满"）。

**Tech Stack:** 原生 JS、xterm.js、ws。**无测试框架**（项目约定），无 git，无构建步骤。

**关于 TDD 偏离：** 项目无测试框架（AGENTS.md §构建/运行/依赖 明确说明）。用浏览器 + Playwright 临时脚本进行端到端验证，验证通过后即视为任务完成。

---

## Task 1: 在模块顶部添加 isFirstList 标志位

**Files:**
- Modify: `public/index.html:186`（在 `let pendingCreate = false;` 下一行）

- [ ] **Step 1: 在 pendingCreate 声明之后添加 isFirstList**

打开 `public/index.html`，定位到 186 行的：

```js
        // 标记"刚才那个 create 请求是不是本客户端发起的"，决定新终端是否自动切换
        let pendingCreate = false;
```

在 `let pendingCreate = false;` 之后**新增一行**：

```js
        let isFirstList = true;  // 重连后第一个 list 标志，用于触发 diff 交集的 buffer 增量拉取
```

完整改动后该区段应为（186→189 行）：

```js
        // 标记"刚才那个 create 请求是不是本客户端发起的"，决定新终端是否自动切换
        let pendingCreate = false;
        let isFirstList = true;  // 重连后第一个 list 标志，用于触发 diff 交集的 buffer 增量拉取
```

---

## Task 2: 在 connect() 的 ws.onopen 中重置标志位

**Files:**
- Modify: `public/index.html:215-219`（`connect()` 函数内）

- [ ] **Step 1: 修改前的 connect() 形态**

当前 `connect()` 函数（215-219 行附近）：

```js
        function connect() {
            if (!ws || ws.readyState === 3) {
                console.log('重新连接服务器');
                ws = new WebSocket(`${wsProtocol}://${location.host}/cmd/`);
                ws.onclose = () => { pendingCreate = false; };
                ws.onmessage = (event) => {
```

- [ ] **Step 2: 在 new WebSocket 之后插入 ws.onopen**

在 `ws.onclose = () => { pendingCreate = false; };` 这一行**之前**插入：

```js
                ws.onopen = () => {
                    // 重连后第一个 list 标志重置，让 list 处理器对 diff 交集发 buffer 请求
                    isFirstList = true;
                };
```

- [ ] **Step 3: 验证改后形态**

完整改后该区段应为（215-224 行）：

```js
        function connect() {
            if (!ws || ws.readyState === 3) {
                console.log('重新连接服务器');
                ws = new WebSocket(`${wsProtocol}://${location.host}/cmd/`);
                ws.onopen = () => {
                    // 重连后第一个 list 标志重置，让 list 处理器对 diff 交集发 buffer 请求
                    isFirstList = true;
                };
                ws.onclose = () => { pendingCreate = false; };
                ws.onmessage = (event) => {
```

注意：`onopen` 必须放在 `onclose` 之前声明（顺序无关紧要，但与已有的"事件处理集中"风格保持一致——把 `onopen` 紧跟在 `new WebSocket` 之后）。

---

## Task 3: 在 list 处理器中加 diff 交集 buffer 请求

**Files:**
- Modify: `public/index.html:222-244`（list 处理器内）

- [ ] **Step 1: 修改前的 list 处理器**

当前 list 处理器（222-244 行）：

```js
                    if (msg.type === 'list') {
                        if (msg.names) names = msg.names;
                        const currentIds = msg.ids.map(String);
                        currentIds.forEach(id => {
                            if (!terms[id]) {
                                createTermInstance(id);
                            }
                        });
                        Object.keys(terms).forEach(id => {
                            if (!currentIds.includes(id)) {
                                if (terms[id]) {
                                    terms[id].dispose();
                                    delete terms[id];
                                }
                                if (wrappers[id]) {
                                    wrappers[id].remove();
                                    delete wrappers[id];
                                }
                                if (activeId === id) {
                                    activeId = null;
                                }
                            }
                        });
                        if (!activeId && currentIds.length > 0) {
                            // 当前会话被 kill 后，跳到 ID 最大的会话（最新创建）
                            switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
                        }
```

- [ ] **Step 2: 在 createTermInstance 循环后、dispose 循环前插入 oldTermIds 快照**

在第 224 行 `const currentIds = msg.ids.map(String);` **之后**、第 225 行 `currentIds.forEach(id => {` **之前**，新增一行：

```js
                        const oldTermIds = Object.keys(terms);  // 关键: diff 之前的 term 集合快照
```

- [ ] **Step 3: 在 dispose 循环之后、activeId 处理之前插入 isFirstList 守卫块**

定位到 dispose 循环结束的位置（在 `if (activeId === id) { activeId = null; }` 闭合后的 `});` 之后），紧接着是：

```js
                        if (!activeId && currentIds.length > 0) {
                            // 当前会话被 kill 后，跳到 ID 最大的会话（最新创建）
                            switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
                        }
```

在 dispose 循环结束 `});` 之后、`if (!activeId && currentIds.length > 0) {` 之前，**插入以下 8 行**：

```js
                        // 新增: 重连后第一个 list，对 diff 交集（即双方都有的 term）发 buffer 请求
                        // 常规 session create / kill 的 list 不会进入此分支，避免误刷旧 term 导致闪烁
                        if (isFirstList) {
                            isFirstList = false;
                            oldTermIds.forEach(id => {
                                if (currentIds.includes(id) && terms[id]) {
                                    ws.send(JSON.stringify({ type: 'buffer', id: id }));
                                }
                            });
                        }
```

- [ ] **Step 4: 验证改后完整 list 处理器**

完整改后该区段应为（222-261 行）：

```js
                    if (msg.type === 'list') {
                        if (msg.names) names = msg.names;
                        const currentIds = msg.ids.map(String);
                        const oldTermIds = Object.keys(terms);  // 关键: diff 之前的 term 集合快照
                        currentIds.forEach(id => {
                            if (!terms[id]) {
                                createTermInstance(id);
                            }
                        });
                        Object.keys(terms).forEach(id => {
                            if (!currentIds.includes(id)) {
                                if (terms[id]) {
                                    terms[id].dispose();
                                    delete terms[id];
                                }
                                if (wrappers[id]) {
                                    wrappers[id].remove();
                                    delete wrappers[id];
                                }
                                if (activeId === id) {
                                    activeId = null;
                                }
                            }
                        });
                        // 新增: 重连后第一个 list，对 diff 交集（即双方都有的 term）发 buffer 请求
                        // 常规 session create / kill 的 list 不会进入此分支，避免误刷旧 term 导致闪烁
                        if (isFirstList) {
                            isFirstList = false;
                            oldTermIds.forEach(id => {
                                if (currentIds.includes(id) && terms[id]) {
                                    ws.send(JSON.stringify({ type: 'buffer', id: id }));
                                }
                            });
                        }
                        if (!activeId && currentIds.length > 0) {
                            // 当前会话被 kill 后，跳到 ID 最大的会话（最新创建）
                            switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
                        }
```

**关键不变量检查**：
- `oldTermIds` 必须在 `currentIds.forEach` 之前**先**取快照（因为 forEach 中 `createTermInstance` 会修改 `terms`）
- `isFirstList` 必须在发完所有 buffer 请求后再置 `false`
- `isFirstList` 守卫块必须在 `if (!activeId ...)` 之前（虽然顺序对功能无影响，但保持"list 处理器职责集中"风格）

---

## Task 4: createTermInstance 保持不变

**Files:** 无修改

`public/index.html:294-320` 的 `createTermInstance` 函数**完全不动**。该函数在 314 行的 `ws.send(JSON.stringify({ type: 'buffer', id: id }));` 是**新 xterm 填满 buffer** 的职责入口，必须保留。

**为何不动**：按职责对称原则。`createTermInstance` 创建一个全新 xterm 时 xterm 是空的，必须从服务端拉 buffer 才能显示任何内容。如果去掉该 buffer 请求，新 xterm 会一直空着等 `data` 推送（如果服务端暂时没输出，用户看到的就是空白）。

覆盖场景：
- 首次连接时：新 xterm 创建后立刻拉 buffer，得到 PowerShell 提示符
- 重连时其他客户端新建的会话：新 xterm 创建后立刻拉 buffer，得到断网期间服务端已积累的全部内容
- 本客户端点击「新建终端」时：新 xterm 创建后立刻拉 buffer，得到新会话的初始状态

---

## Task 5: 验证 JS 语法

**Files:** 无修改

- [ ] **Step 1: 用 Node.js 检查 index.html 内联脚本的语法**

```bash
node -e "const fs = require('fs'); const html = fs.readFileSync('public/index.html', 'utf8'); const m = html.match(/<script>([\s\S]*?)<\/script>/); new Function(m[1]); console.log('syntax OK');"
```

预期输出：`syntax OK`

**注**：无法用 Node.js 实际执行（依赖浏览器环境的 `ws`、`xterm`、`document` 等），`new Function(m[1])` 只做语法解析检查，不实际运行。

- [ ] **Step 2: 确认无意外的字段名错误**

用 grep 确认：
- `isFirstList` 在文件中**只**在新增的位置出现
- `pendingCreate` 仍然只在 `createNew`、`createTermInstance`、`ws.onclose` 三处出现

```bash
grep -n "isFirstList" public/index.html
grep -n "pendingCreate" public/index.html
```

预期 `isFirstList` 出现 4 次（1 处声明 + 1 处 onopen 重置 + 2 处 list 处理器内 if/set）
预期 `pendingCreate` 出现 4 次（保持现状，不变）

---

## Task 6: 启动服务并用 Playwright 端到端验证

**Files:** 无修改

- [ ] **Step 1: 检查后端服务是否已在运行**

按 AGENTS.md §开发工作流 规则，先检查后端：

```bash
powershell -Command "Get-NetTCPConnection -LocalPort 65433 -ErrorAction SilentlyContinue | Select-Object State, OwningProcess"
```

- 如果输出非空且 `State` 为 `Listen`，则服务已在跑，**不要重启**，直接走 Step 2
- 如果输出为空，启动服务（非阻塞）：

```bash
cd "c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD" && node server.js
```

服务监听 `http://localhost:65433`。

- [ ] **Step 2: 验证首次连接（场景 B：isFirstList 守卫对空交集不动作）**

打开浏览器访问 `http://localhost:65433/`。

**预期**：
- 页面加载后约 1 秒内出现 PowerShell 提示符
- 下拉框显示 `Shell #1`（或当前命名规则下的名称）
- 控制台**不应**有 `TypeError` 报错
- xterm 显示正常

- [ ] **Step 3: 验证常规 session create 不误刷旧 term（场景 C）**

1. 在当前 term 里运行 `Get-Process`（产生一些输出，等待命令完成）
2. 点击「新建终端」按钮
3. **预期**：
   - 立即看到新终端（自动切换到新 term）
   - 切换**回**第一个 term（通过下拉框）
   - 第一个 term 的 `Get-Process` 输出**完整保留**，无内容被重置/闪烁

- [ ] **Step 4: 验证重连后 buffer 拉取（场景 A：主要修复场景）**

1. 在当前 term 里运行 `while ($true) { Get-Date; Start-Sleep 1 }`（每秒持续输出）
2. 等几秒看到持续输出
3. F12 打开 DevTools → Console 面板
4. 在 Console 中执行（**关键：模拟网络断开**）：

```javascript
ws.close()
```

5. 观察状态灯：`已连接` → `已断连`
6. 等待 30 秒（此时服务端 buffer 还在持续累积，但客户端拿不到新数据）
7. 等待 1s 轮询自动重连（应该会看到 `重新连接服务器` console log）
8. **预期**：
   - 状态灯回到 `已连接`
   - xterm 立即**补齐 30 秒内错过的所有 Get-Date 输出**
   - 后续实时输出无缝接上
   - **关键观察**：term 容器内的 wrapper **没有重新创建**（无闪烁），只是 xterm 内部 `reset + write`
   - 在 Console 中**额外**观察 `ws.send` 次数：重连后第一个 list 到达时应有 `N` 个 buffer 请求（N = 当时本地 term 数）

- [ ] **Step 5: 验证跨客户端不误刷（场景 C/D 补充）**

如果有第二个浏览器窗口（或第二个标签页）连接到同一服务：

1. 窗口 A：当前 term 运行 `Get-Process`（等待完成）
2. 窗口 B：当前 term 也运行 `Get-Process`（等待完成）
3. 窗口 A：点击「新建终端」
4. **预期**：
   - 窗口 A 自动切到新 term
   - 窗口 B 不自动切，但下拉框多了一项
   - 窗口 B 切回原 term 时，**内容完整保留**（无 reset 闪烁）

- [ ] **Step 6: 关闭服务（如果是新启动的）**

如果服务是 Step 1 中新启动的（非已存在），回到启动 `node server.js` 的终端，Ctrl+C 终止。

**如果服务是之前已存在的，不要动它**（按 AGENTS.md §开发工作流 规则）。

---

## Task 7: 更新 AGENTS.md 已知注意事项

**Files:**
- Modify: `AGENTS.md`（在「已知注意事项」列表追加第 12 条）

- [ ] **Step 1: 追加第 12 条**

在 `AGENTS.md` 的「已知注意事项」列表追加第 12 条（接续已有的 11 条之后）：

```markdown
12. **重连后 buffer 增量拉取**：list 处理器中 `isFirstList` 标志位在 `ws.onopen` 中重置为 true。重连后第一个 list 到达时，对 `oldTermIds ∩ currentIds`（即双方都有的 term）发 `{type:'buffer'}` 请求，断网期间的内容用 `term.reset() + term.write()` 补回。常规 session create / kill 的 list 不会进入该分支，避免误刷旧 term 导致闪烁。`createTermInstance` 内既有的 buffer 请求保留（按职责对称：新建 xterm 立刻拉 buffer 填满）。
```

**注**：项目非 git 仓库，无 commit 步骤。

---

## 任务完成检查

- [ ] `public/index.html` 第 186 行后已添加 `let isFirstList = true;`
- [ ] `public/index.html` 第 215 行附近 `connect()` 内已添加 `ws.onopen` 重置标志
- [ ] `public/index.html` 第 222 行附近 list 处理器已添加 `oldTermIds` 快照和 `isFirstList` 守卫块
- [ ] `createTermInstance` 函数**未改动**（`ws.send({type:'buffer'})` 仍在第 314 行）
- [ ] JS 语法检查通过（`new Function(m[1])` 无异常）
- [ ] 首次连接正常（场景 B 验证）
- [ ] 常规 session create 不误刷旧 term（场景 C 验证）
- [ ] 重连后 buffer 拉取补回断网期间内容（场景 A 验证，**核心 bug 修复**）
- [ ] 跨客户端不误刷（场景 C/D 验证）
- [ ] `AGENTS.md` 已追加第 12 条注意事项
