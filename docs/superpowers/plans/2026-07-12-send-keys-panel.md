# 直接发送快捷键面板（发按键）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在浏览器终端底部栏最左侧新增一个"发按键"按钮，点击弹出小面板，勾选修饰键（Ctrl/Alt/Shift）+ 点主键（字母/功能键）后当场把组合序列发送到当前活动终端，不预设、不持久化、发完面板自动关闭。

**Architecture:** 纯前端改动，复用现有 `parseHotkey()`（字符串→转义序列）与 `sendInput()`（→ `wsSend({type:'input'})`）链路。新增一组弹窗函数（`openSendKeysPanel`/`closeSendKeysPanel`/`toggleMod`/`clearMods`/`pickAndSend`）+ 一个全局 `activeMods` 集合 + 两个常量数组；按钮挂在 `#hotkeys-bar` 下、`#hotkeysList` 之外（避开 `renderHotkeys` 的 `innerHTML=''` 清空）。`server.js` 与 WebSocket 协议完全不动。

**Tech Stack:** 原生 HTML/JS（CommonJS 风格前端、无打包工具、无框架），xterm.js 终端；CSS 纯手写。无测试框架（项目 AGENTS.md 明确：无测试/无 linter），验证方式为浏览器实测。

## Global Constraints

- 纯前端改动，**不重启服务器**；测试连现有 `http://localhost:<端口>/`，刷新静态文件即可加载新前端（AGENTS.md 开发纪律）。
- **禁止 `git add -A`**；每次 commit 显式指定文件（AGENTS.md git 工作流）。
- 每个独立改动一个 commit；改完 commit 前把 diff 打给用户复核（用户铁律）。
- 复用服务端权威链路：`sendInput`→`wsSend input`，无乐观状态、不新增协议。
- "发按键"按钮必须位于底部快捷键栏**最左**（用户明确要求）。
- 交互形态（已确认）：弹出式面板；勾选式组合（方案 A，非物理按住）；点主键即自动发送；发完面板自动关闭。
- `MODIFIER_KEYS = ['Ctrl','Alt','Shift']`；`PRIMARY_KEYS` 与现有 `availableKeys` 内容相同但是独立新增常量，现有 `availableKeys` 保留不动。
- 性能影响：弹窗打开创建约 50 个按钮节点（仅面板生命周期内，关闭即销毁），零新增网络、零协议变更，可忽略。

---

### Task 1: 底部栏加"发按键"按钮（最左）

**Files:**
- Modify: `public/index.html:27-29`（`<div id="hotkeys-bar">` 区块）

**Interfaces:**
- Produces: `id="sendKeysBtn"` 按钮元素（后续 Task 2/4 的函数通过 `onclick` 引用 `openSendKeysPanel`，本任务仅放按钮与 `onclick`）。

- [ ] **Step 1: 在 `#hotkeys-bar` 内、`#hotkeysList` 之前插入"发按键"按钮**

将 `index.html` 行 27-29：
```html
        <div id="hotkeys-bar">
            <div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;">
                <button id="editBtn">编辑</button>
```
改为：
```html
        <div id="hotkeys-bar">
            <button id="sendKeysBtn" onclick="openSendKeysPanel()">发按键</button>
            <div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;">
                <button id="editBtn">编辑</button>
```

- [ ] **Step 2: 浏览器实测按钮出现在最左**

打开 `http://localhost:<端口>/`（不重启），确认底部栏**最左**出现"发按键"按钮（此时点它尚无反应，因为 `openSendKeysPanel` 尚未定义——属预期，下一步才加）。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 底部栏最左新增发按键按钮（面板函数后续接入）"
```

---

### Task 2: 新增常量与全局状态

**Files:**
- Modify: `public/index.html:111`（`const availableKeys = [...]` 行之后）

**Interfaces:**
- Consumes: 无（独立基础设施）
- Produces: 全局 `MODIFIER_KEYS`、`PRIMARY_KEYS`（数组）、`activeMods`（Set），供 Task 3/4 的函数使用。

- [ ] **Step 1: 在 `availableKeys` 定义之后新增常量与状态**

将 `index.html` 行 111-112：
```js
        const availableKeys = ['Ctrl', 'Alt', 'Shift', '↑', '↓', '→', '←', 'Up', 'Down', 'Right', 'Left', 'Home', 'End', 'PgUp', 'PgDn', 'Insert', 'Delete', 'Tab', 'Enter', 'Esc', 'Backspace', 'Space', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
```
改为（保留原 `availableKeys`，新增两个独立常量 + 状态）：
```js
        const availableKeys = ['Ctrl', 'Alt', 'Shift', '↑', '↓', '→', '←', 'Up', 'Down', 'Right', 'Left', 'Home', 'End', 'PgUp', 'PgDn', 'Insert', 'Delete', 'Tab', 'Enter', 'Esc', 'Backspace', 'Space', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        // 直接发送面板用：修饰键（勾选式组合，单独成区）
        const MODIFIER_KEYS = ['Ctrl', 'Alt', 'Shift'];
        // 直接发送面板用：主键（字母 + 功能键，点一下即与当前勾选的修饰键组合并发送）
        const PRIMARY_KEYS = ['↑', '↓', '→', '←', 'Up', 'Down', 'Right', 'Left', 'Home', 'End', 'PgUp', 'PgDn', 'Insert', 'Delete', 'Tab', 'Enter', 'Esc', 'Backspace', 'Space', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        // 当前勾选的修饰键（方案A：勾选式组合，非物理按住）
        let activeMods = new Set();
```

- [ ] **Step 2: 浏览器实测无语法错误**

打开 `http://localhost:<端口>/`，浏览器控制台执行 `typeof MODIFIER_KEYS !== 'undefined' && typeof PRIMARY_KEYS !== 'undefined' && activeMods instanceof Set`，应返回 `true`；页面无 JS 报错（控制台无红色 error）。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 新增发按键面板用的修饰键/主键常量与勾选状态"
```

---

### Task 3: 新增面板函数 openSendKeysPanel / closeSendKeysPanel / toggleMod / clearMods / pickAndSend

**Files:**
- Modify: `public/index.html`（放在 `function openHotkeyEditor()` 定义之前，即行 701 之前插入；或紧跟 `openHotkeyEditor` 之后均可，这里选在行 700 空行后、701 前插入）

**Interfaces:**
- Consumes: `MODIFIER_KEYS`、`PRIMARY_KEYS`、`activeMods`（Task 2）；`parseHotkey`（现有，行 87-110）；`sendInput`（现有，行 676）；`addFrontendLog`（现有，行 76-84）。
- Produces: `openSendKeysPanel()`、`closeSendKeysPanel()`、`toggleMod(btn)`、`clearMods()`、`pickAndSend(btn)`；全局句柄 `sendKeysPanel`（面板 DOM 引用，类比 `editorDiv`）。

- [ ] **Step 1: 插入面板函数**

在 `index.html` 行 701（`function openHotkeyEditor() {`）**之前**插入以下代码：

```js
        // === 直接发送快捷键面板（发按键，方案A：勾选式组合，不预设不持久化）===
        let sendKeysPanel = null;
        function openSendKeysPanel() {
            if (sendKeysPanel) { sendKeysPanel.remove(); sendKeysPanel = null; }
            activeMods.clear();  // 每次打开重置勾选
            let html = '<div class="modal-overlay" style="z-index:1000;">';
            html += '<div class="modal-box" style="min-width:360px;">';
            html += '<h3>发送按键</h3>';
            // 修饰键勾选区
            html += '<div class="modal-row" style="flex-direction:column;align-items:flex-start;gap:4px;">';
            html += '<div style="color:#a0a0a0;">修饰键（可多选）</div>';
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
            MODIFIER_KEYS.forEach(k => {
                html += `<button type="button" onclick="toggleMod(this)" data-mod="${k}">${k}</button>`;
            });
            html += '<button type="button" onclick="clearMods()">清空修饰键</button>';
            html += '</div></div>';
            // 主键区（点一下即发送）
            html += '<div class="modal-row" style="flex-direction:column;align-items:flex-start;gap:4px;">';
            html += '<div style="color:#a0a0a0;">主键（点一下即发送到当前终端）</div>';
            html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
            PRIMARY_KEYS.forEach(k => {
                html += `<button type="button" onclick="pickAndSend(this)">${k}</button>`;
            });
            html += '</div></div>';
            html += '<div class="modal-actions">';
            html += '<button onclick="closeSendKeysPanel()" style="margin-left:auto;">关闭</button>';
            html += '</div></div></div>';
            const div = document.createElement('div');
            div.innerHTML = html;
            sendKeysPanel = div.firstElementChild;
            document.body.appendChild(sendKeysPanel);
        }
        function closeSendKeysPanel() {
            if (sendKeysPanel) { sendKeysPanel.remove(); sendKeysPanel = null; }
            activeMods.clear();
        }
        // 勾选/取消修饰键，toggle 按钮高亮
        function toggleMod(btn) {
            const mod = btn.dataset.mod;
            if (activeMods.has(mod)) {
                activeMods.delete(mod);
                btn.classList.remove('mod-active');
            } else {
                activeMods.add(mod);
                btn.classList.add('mod-active');
            }
        }
        // 清空所有修饰键勾选
        function clearMods() {
            activeMods.clear();
            document.querySelectorAll('.modal-box button.mod-active').forEach(b => b.classList.remove('mod-active'));
        }
        // 点主键：与当前勾选的修饰键拼成组合名，当场发送并关闭面板（一次一个）
        function pickAndSend(btn) {
            const name = [...activeMods, btn.textContent].join('+');
            sendInput(parseHotkey(name));
            addFrontendLog('直接发送: ' + name, 'out');
            closeSendKeysPanel();
        }
```

- [ ] **Step 2: 浏览器实测完整交互**

打开 `http://localhost:<端口>/`，点击底部"发按键"按钮，验证：
1. 面板弹出，含修饰键区（Ctrl/Alt/Shift + 清空修饰键）与主键区（字母+功能键）。
2. 勾 Ctrl（按钮变蓝高亮）→ 点 C → 控制台日志出现"直接发送: Ctrl+C"（方向 `→`），面板自动关闭；当前终端收到 `\x03`（可用 PowerShell 中断 `Read-Host` 验证）。
3. 再点"发按键"→ 勾 Alt → 点 M → 收到 `\x1bm`（Escape + 小写 m，符合 AGENTS.md 注意事项 23）。
4. 验证发完后面板自动关闭、下次打开修饰键已清空（Ctrl 不再高亮）。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 发按键面板核心逻辑（勾选修饰键+点主键当场发送）"
```

---

### Task 4: 新增 .mod-active 高亮 CSS

**Files:**
- Modify: `public/styles.css:111`（`.modal-row + .modal-row` 块之后）

**Interfaces:**
- Consumes: `toggleMod`/`clearMods` 给按钮加/去 `.mod-active` 类（Task 3 已用此 class 名）。
- Produces: `.mod-active` 样式规则（蓝底白字）。

- [ ] **Step 1: 在 `.modal-row + .modal-row` 后插入 .mod-active 样式**

将 `styles.css` 行 111-113：
```css
        .modal-row + .modal-row {
            margin-top: 8px;
        }
```
改为：
```css
        .modal-row + .modal-row {
            margin-top: 8px;
        }
        /* 修饰键勾选高亮（发按键面板，方案A） */
        .mod-active {
            background: #2d6cdf;
            color: #fff;
            border-color: #2d6cdf;
        }
```

- [ ] **Step 2: 浏览器实测高亮生效**

打开 `http://localhost:<端口>/`，点"发按键"→ 勾 Ctrl/Alt/Shift，确认被勾选的按钮变蓝底白字；点"清空修饰键"或发完按键后变回普通样式。

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat: 发按键面板修饰键勾选高亮样式"
```

---

### Task 5: 边界情况回归 + AGENTS.md 补充

**Files:**
- Modify: `public/index.html`（无需改代码，仅验证）
- Modify: `AGENTS.md`（在"已知注意事项"末尾新增第 33 条）

**Interfaces:**
- Consumes: 全部 Task 1-4 的功能。
- Produces: AGENTS.md 第 33 条文档（记录此机制，遵循 AGENTS.md 更新规则）。

- [ ] **Step 1: 边界情况浏览器实测**

打开 `http://localhost:<端口>/`，逐项验证：
1. **无活动终端**（`activeId == null`）：理论上需先关掉所有终端再测；`sendInput` 内置 `if (activeId)` 守卫，静默不发，仍记日志、面板关闭。
2. **只勾修饰键不点主键**：仅高亮，不发送。
3. **不勾修饰键直接点主键 C**：组合名 `"C"`，`parseHotkey("C")` 末路 `return s` → 发字母 C 本身，合理。
4. **WS 未连接**：`wsSend` 内置 `readyState !== 1` 守卫，静默失败，面板关闭。
5. **重复点"发按键"**：`openSendKeysPanel` 开头 `if (sendKeysPanel) remove` 防重复实例。
6. **回归**：旧预设快捷键（如底部 Ctrl+C 按钮）照常工作，编辑弹窗照常可用。

- [ ] **Step 2: 在 AGENTS.md 末尾新增第 33 条**

在 `AGENTS.md` 的"已知注意事项"第 32 条之后，新增：

```markdown
33. **直接发送快捷键面板「发按键」（2026-07-12 引入）**：底部快捷键栏**最左**新增「发按键」按钮（位于 `#hotkeysList` 之外、`#hotkeys-bar` 直接子元素），点击弹出小面板。面板内勾选修饰键（Ctrl/Alt/Shift，可多勾，`.mod-active` 高亮）+ 点主键（字母/功能键），**点主键即当场把组合序列通过 `sendInput(parseHotkey(组合名))` 发到当前活动终端**，不预设、不持久化、`server.js` 与 WebSocket 协议完全不动。发完面板自动关闭（一次一个），下次打开 `activeMods` 已清空。
    - **复用**：`parseHotkey()`（Ctrl 大写公式 / Alt 小写 / Shift 规则不变）、`sendInput()`（→ `wsSend input`）、`activeId`。
    - **新增常量**：`MODIFIER_KEYS = ['Ctrl','Alt','Shift']`、`PRIMARY_KEYS`（与 `availableKeys` 内容相同但是独立常量，原 `availableKeys` 保留不动）。
    - **新增状态/函数**：全局 `activeMods`（Set）、`openSendKeysPanel` / `closeSendKeysPanel` / `toggleMod` / `clearMods` / `pickAndSend`。面板 DOM 句柄 `sendKeysPanel`（类比 `editorDiv`）。
    - **按钮位置关键**：放在 `#hotkeysList` **之外**，因为 `renderHotkeys()` 内 `bar.innerHTML=''` 会清空 `#hotkeysList` 全部子节点再重建（只重附 `editBtnEl`/`scrollGroupEl`），放外面可避开被误清。
    - **性能**：弹窗打开创建约 50 个按钮节点（仅面板生命周期内，关闭即销毁），零新增网络、零协议变更，可忽略。
    - **纯前端改动**：只改前端不重启服务器，连现有 <端口> 刷新即可。
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 第33条记录发按键直接发送面板机制"
```

---

## Self-Review

**1. Spec coverage:**
- 功能定位/目标（spec 一、二）→ Task 1-3 实现。
- 按钮最左（spec 二、四改动1）→ Task 1。
- 数据流（spec 三）→ Task 3 `pickAndSend`。
- UI 结构与改动位置（spec 四）→ Task 1（按钮）、Task 2（常量）、Task 3（函数）、Task 4（CSS）。
- 边界情况（spec 五）→ Task 5 Step 1。
- 性能影响（spec 六）→ 写入 Global Constraints 与 spec，Task 4 注释提及。
- 遵守约定（spec 七）→ 全程遵循（不重启、commit 前复核、AGENTS.md 更新）→ Task 5 Step 2。
- 测试验证（spec 八）→ 分布于 Task 1-5 的"浏览器实测"步骤。

**2. Placeholder scan:** 无 TBD/TODO/"类似 Task N"。每步均含完整代码或精确命令。

**3. Type consistency:** `MODIFIER_KEYS`/`PRIMARY_KEYS`/`activeMods` 在 Task 2 定义、Task 3 使用，命名一致；`sendKeysPanel` 在 Task 3 定义与使用一致；`pickAndSend(btn)`/`toggleMod(btn)`/`clearMods()` 签名跨 Task 3/5 一致；`.mod-active` 类在 Task 3（加/去）与 Task 4（样式）一致。无矛盾。
