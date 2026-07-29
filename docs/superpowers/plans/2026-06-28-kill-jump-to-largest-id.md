# Kill 终端跳转到最大 ID 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修改前端 list 处理器，在当前会话被 kill 后跳转到 ID 最大的会话（最新创建），而非列表第一项。

**Architecture:** 纯前端单文件改动。`reduce` 取 `currentIds` 数组中数值最大的元素作为跳转目标。`reduce` 对单元素数组直接返回该元素（不调用回调），结合现有的 `currentIds.length > 0` 守卫确保安全。

**Tech Stack:** 原生 JS、xterm.js、ws。**无测试框架**（项目约定），无构建步骤。

**关于 TDD 偏离：** 项目无测试框架（AGENTS.md §构建/运行/依赖 明确说明）。用浏览器 + Playwright 临时脚本进行端到端验证，验证通过后即视为任务完成。

---

## Task 1: 修改 list 处理器中的兜底跳转

**Files:**
- Modify: `public/index.html:111`（在 `if (!activeId && currentIds.length > 0) {` 块内）

- [ ] **Step 1: 修改前定位目标代码**

打开 `public/index.html`，定位到第 111 行附近的 list 处理器。当前代码类似：

```js
                        if (!activeId && currentIds.length > 0) {
                            switchSession(currentIds[0]);
                        }
```

- [ ] **Step 2: 替换为目标代码**

将 `switchSession(currentIds[0]);` 这一行替换为：

```js
                            // 当前会话被 kill 后，跳到 ID 最大的会话（最新创建）
                            switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
```

完整改动后该块应为：

```js
                        if (!activeId && currentIds.length > 0) {
                            // 当前会话被 kill 后，跳到 ID 最大的会话（最新创建）
                            switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
                        }
```

- [ ] **Step 3: 验证 JS 语法正确性**

**注意**：无法使用 Node.js 单独执行（依赖 `ws`、`xterm` 等浏览器环境），用内联脚本做语法检查即可。

```bash
node -e "const fs = require('fs'); const html = fs.readFileSync('public/index.html', 'utf8'); const m = html.match(/<script>([\s\S]*?)<\/script>/); new Function(m[1]); console.log('syntax OK');"
```

预期输出：`syntax OK`

- [ ] **Step 4: 启动服务并用 Playwright 自动化测试**

**4.1 启动服务**（非阻塞）：

```bash
cd "c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD" && node server.js
```

服务监听 `http://localhost:<端口>`。

**4.2 编写并执行 Playwright 验证脚本**（一次性的，验证后删除）：

```javascript
// verify_kill_jump.js
const { chromium } = require('playwright');
const WS_URL = 'ws://localhost:<端口>/cmd/';
const PAGE_URL = 'http://localhost:<端口>/';

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', msg => console.log('[console]', msg.text()));
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await page.goto(PAGE_URL);
    await page.waitForSelector('#terminal-area .term-wrapper', { timeout: 5000 });

    // 通过 ws 注入：直接调用 WebSocket 协议创建 3 个会话
    const setupIds = await page.evaluate(async (WS_URL) => {
        return new Promise((resolve) => {
            const ws = new WebSocket(WS_URL);
            const ids = [];
            ws.onopen = () => {
                // 已有 1 个默认会话，id 1
                // 关闭连接
                ws.close();
            };
            ws.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.type === 'list') {
                    msg.ids.forEach(id => ids.push(String(id)));
                    if (ids.length >= 3) resolve(ids);
                }
            };
        });
    }, WS_URL);

    // 实际上更简单：直接通过 UI 按钮创建 2 个新会话
    // 这里给出简化策略 —— 在浏览器中点两次"新建终端"按钮（依据实际 DOM 选择器）
    const newBtn = await page.$('button:has-text("新建终端"), button:has-text("New")');
    // 如果按钮选择器不确定，直接通过 WebSocket 协议控制更可靠：

    const result = await page.evaluate(async (WS_URL) => {
        const log = [];
        function createWs() {
            return new Promise((resolve) => {
                const ws = new WebSocket(WS_URL);
                ws.onopen = () => resolve(ws);
            });
        }
        const ws = await createWs();
        const messages = [];
        ws.onmessage = (e) => messages.push(JSON.parse(e.data));

        // 收集 list 消息的辅助
        function waitList(timeout = 1000) {
            return new Promise((resolve) => {
                const timer = setTimeout(() => resolve(messages[messages.length - 1]), timeout);
                const check = setInterval(() => {
                    const last = messages[messages.length - 1];
                    if (last && last.type === 'list') {
                        clearTimeout(timer);
                        clearInterval(check);
                        resolve(last);
                    }
                }, 20);
            });
        }

        // 第一次 list（连接时）
        await new Promise(r => setTimeout(r, 300));
        const initial = messages.find(m => m.type === 'list');
        log.push({ step: 'initial', ids: initial.ids });

        // 创建 2 个新会话
        ws.send(JSON.stringify({ type: 'create' }));
        await waitList();
        ws.send(JSON.stringify({ type: 'create' }));
        const all = messages.filter(m => m.type === 'list');
        const full = all[all.length - 1];
        log.push({ step: 'after 2 creates', ids: full.ids });
        const allIds = full.ids.map(String);

        // 通过 UI 切换到中间会话
        const sel = document.querySelector('#session-select, select');
        if (sel) {
            const mid = allIds[Math.floor(allIds.length / 2)];
            sel.value = mid;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 200));
        log.push({ step: 'after select mid', activeId: window.activeId || 'N/A' });

        // kill 当前（中间）会话
        const midId = allIds[Math.floor(allIds.length / 2)];
        ws.send(JSON.stringify({ type: 'kill', id: midId }));
        await waitList();
        await new Promise(r => setTimeout(r, 200));

        const dropdown = document.querySelector('#session-select, select');
        log.push({
            step: 'after kill mid',
            selectedInUI: dropdown ? dropdown.value : 'N/A',
            expectedMax: String(Math.max(...allIds.filter(id => id !== midId).map(Number)))
        });

        ws.close();
        return log;
    }, WS_URL);

    console.log(JSON.stringify(result, null, 2));
    await browser.close();
})();
```

**注**：上面是参考脚本。实际编写时根据 `public/index.html` 的真实 DOM 结构（下拉框 id、`activeId` 是否暴露到 `window` 等）做适配。

**预期结果**：
- `after 2 creates.ids` 含 3 个 ID（如 `["1","2","3"]`）
- `after select mid.activeId` 等于中间 ID
- `after kill mid.selectedInUI` 等于剩余 ID 中数值最大者
- `after kill mid.expectedMax` 与 `selectedInUI` 一致

- [ ] **Step 5: 删除临时验证脚本**

```bash
rm verify_kill_jump.js
```

- [ ] **Step 6: 关闭服务**

回到启动 `node server.js` 的终端，Ctrl+C 终止。

- [ ] **Step 7: 更新 AGENTS.md 已知注意事项**

在 `AGENTS.md` 的「已知注意事项」列表追加第 11 条（接续已有的 10 条之后）：

```markdown
11. **删除当前终端后跳到 ID 最大者**：list 处理器中 `if (!activeId && currentIds.length > 0)` 分支使用 `currentIds.reduce((a, b) => +a > +b ? a : b)` 选取目标，跳到最新创建的会话（而非下拉框第一个）。`reduce` 对单元素数组直接返回该元素，结合 `length > 0` 守卫确保空数组不会触发。
```

**注**：项目非 git 仓库，无 commit 步骤。

---

## 任务完成检查

- [ ] `public/index.html` 第 111 行附近已替换为目标代码
- [ ] JS 语法检查通过（`new Function(m[1])` 无异常）
- [ ] Playwright 验证脚本所有断言通过
- [ ] 临时验证脚本已删除
- [ ] `AGENTS.md` 已追加第 11 条注意事项
