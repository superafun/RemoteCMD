# Ctrl+C 选区复制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 xterm 存在选区时，键盘 / 底部快捷键按钮 / 发按键面板三种路径发送 Ctrl+C 都改为复制选区并清除选区；无选区时仍发 `\x03` 中断。

**Architecture:** 纯前端改动。新增全局复制函数（`copyToClipboard` / `fallbackCopy` / `copyTermSelection` / `sendInputMaybeCopy`），键盘路径在 `term-session.js` 的 `onData` 拦截 `\x03`，按钮与面板改调 `sendInputMaybeCopy`。仅拦截 `\x03`，其他输入不受影响。不动 `server.js`、不加 WebSocket 消息。

**Tech Stack:** 浏览器原生 JS、xterm.js v6（Term 实例的 `hasSelection()` / `getSelection()` / `clearSelection()`）、`navigator.clipboard` + 隐藏 `textarea` + `execCommand('copy')` 兜底。

## Global Constraints

- 纯前端改动，**不重启服务器**；改完刷新页面（静态资源）即可加载（见 AGENTS.md 开发工作流）。
- 仅拦截 Ctrl+C 字节 `\x03`，其他按键/序列行为不变（YAGNI）。
- 复制到剪贴板：`navigator.clipboard.writeText` 优先，`execCommand` 兜底仅作保险（用户环境为 HTTPS，`navigator.clipboard` 可用）。
- 复制完成后**清除** xterm 选区（`term.clearSelection()`）。
- 行为**始终开启**，不加设置开关。
- 每次代码修改完成必须立即 `git commit`，禁止 `git add -A`（AGENTS.md Git 工作流）。
- 单文件风格保持：新增逻辑放进 `public/index.html`（全局函数区），`term-session.js` 仅改 `onData` 回调。

---

## 文件结构

| 文件 | 改动 | 职责 |
|------|------|------|
| `public/index.html` | 修改 | 在全局函数区新增 4 个复制相关函数；把底部按钮与发按键面板的 `sendInput` 调用改为 `sendInputMaybeCopy` |
| `public/term-session.js` | 修改 | `onData` 回调拦截 `\x03` + 选区判定，命中则调 `window.copyTermSelection` 并 return |
| `AGENTS.md` | 修改 | 在「已知注意事项」追加一条，记录新行为 |

---

### Task 1: 新增全局复制函数

**Files:**
- Modify: `public/index.html`（在 `function sendInput(data) {...}` 之后、`function scrollUp()` 之前插入）

**Interfaces:**
- Produces:
  - `copyToClipboard(text: string): void` —— 优先 `navigator.clipboard.writeText`，失败/不可用走 `fallbackCopy`
  - `fallbackCopy(text: string): void` —— 隐藏 textarea + `execCommand('copy')`
  - `copyTermSelection(term: Terminal): void` —— 复制 `term.getSelection()` 并 `term.clearSelection()`，挂到 `window.copyTermSelection` 供 `term-session.js` 调用
  - `sendInputMaybeCopy(data: string): void` —— `data === '\x03'` 且活动会话有选区时复制，否则 `sendInput(data)`

- [ ] **Step 1: 在 `sendInput` 定义之后插入复制相关函数**

定位 `public/index.html` 中：
```js
        function sendInput(data) { if (activeId) wsSend({ type: 'input', id: activeId, data: data }); }
        function scrollUp() { sessions.get(activeId)?.sendSgrWheel(-1); }
```
替换为：
```js
        function sendInput(data) { if (activeId) wsSend({ type: 'input', id: activeId, data: data }); }

        // === Ctrl+C 选区复制 ===
        // 复制到剪贴板：优先 navigator.clipboard，失败/不可用退回 execCommand 兜底
        function copyToClipboard(text) {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
        }
        // 非 secure 上下文兜底（用户环境为 HTTPS，此路径仅作保险）
        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            ta.remove();
        }
        // 复制终端选区并清除选区（供键盘路径 term-session.js 调用）
        function copyTermSelection(term) {
            const sel = term.getSelection();
            if (sel) copyToClipboard(sel);
            term.clearSelection();
        }
        window.copyTermSelection = copyTermSelection;

        // 发送输入，但 Ctrl+C 在存在选区时改为复制
        function sendInputMaybeCopy(data) {
            if (data === '\x03') {
                const s = sessions.get(activeId);
                if (s && s.term.hasSelection()) { copyTermSelection(s.term); return; }
            }
            sendInput(data);
        }

        function scrollUp() { sessions.get(activeId)?.sendSgrWheel(-1); }
```

- [ ] **Step 2: 验证语法**
  打开 `public/index.html`，确认新增函数块无语法错误（`function sendInputMaybeCopy`、`window.copyTermSelection` 均在 `sendInput` 之后定义，且 `copyToClipboard`/`fallbackCopy`/`copyTermSelection` 顺序正确、互相引用闭合）。

- [ ] **Step 3: 提交**
```bash
git add public/index.html
git commit -m "feat: 新增 Ctrl+C 选区复制全局函数"
```

---

### Task 2: 底部按钮与发按键面板改调 sendInputMaybeCopy

**Files:**
- Modify: `public/index.html`（两处调用点）

**Interfaces:**
- Consumes: `sendInputMaybeCopy(data: string)`（Task 1 产出）

- [ ] **Step 1: 底部快捷键按钮 onclick 改调**
定位：
```js
                btn.onclick = () => sendInput(hotkeys[name]);
```
替换为：
```js
                btn.onclick = () => sendInputMaybeCopy(hotkeys[name]);
```

- [ ] **Step 2: 发按键面板 pickAndSend 改调**
定位：
```js
            sendInput(parseHotkey(name));
```
替换为：
```js
            sendInputMaybeCopy(parseHotkey(name));
```

- [ ] **Step 3: 验证**
确认 `public/index.html` 中仅剩这两处 `sendInput(` 调用点被替换（`sendInput` 函数定义本身仍保留，被 `sendInputMaybeCopy` 内部调用，不要误删）。全文搜索 `sendInput(` 应看到：`function sendInput(...)`、`sendInputMaybeCopy` 内 `sendInput(data)`、以及可能的其它既有调用（如滚动等，保持不动）。

- [ ] **Step 4: 提交**
```bash
git add public/index.html
git commit -m "feat: 底部按钮与发按键面板接入 Ctrl+C 选区复制"
```

---

### Task 3: 键盘路径在 term-session.js 拦截 Ctrl+C

**Files:**
- Modify: `public/term-session.js`（`TermSession` 构造内的 `term.onData` 回调）

**Interfaces:**
- Consumes: `window.copyTermSelection(term: Terminal)`（Task 1 产出，挂到 window）
- Produces: 无新增导出

- [ ] **Step 1: 修改 onData 回调**
定位：
```js
        // 输入转发到服务端
        this.term.onData(data => {
            wsSend({ type: 'input', id: this.id, data: data });
        });
```
替换为：
```js
        // 输入转发到服务端
        this.term.onData(data => {
            // 有选区时 Ctrl+C 改为复制并吞掉，不发给服务端
            if (data === '\x03' && this.term.hasSelection()) {
                if (window.copyTermSelection) window.copyTermSelection(this.term);
                return;
            }
            wsSend({ type: 'input', id: this.id, data: data });
        });
```

- [ ] **Step 2: 验证**
确认 `term-session.js` 中 `onData` 逻辑：仅当 `data === '\x03'` 且 `this.term.hasSelection()` 为真时拦截；其余按键（含普通字符、方向键、Tab 等）仍走 `wsSend`。`window.copyTermSelection` 用 `if` 守卫，term-session.js 不依赖 index.html 加载顺序。

- [ ] **Step 3: 提交**
```bash
git add public/term-session.js
git commit -m "feat: 键盘 Ctrl+C 有选区时复制而不发中断"
```

---

### Task 4: 浏览器/真机验证

**Files:** 无代码改动

- [ ] **Step 1: 确认后端在跑（只改前端不重启）**
```powershell
Get-NetTCPConnection -LocalPort <端口>
```
预期：存在 LISTENING 状态的连接。若不在跑才需要 `npm start`（本任务假定已在跑）。

- [ ] **Step 2: 浏览器刷新加载新前端**
在已连 <端口> 的浏览器中刷新页面（Ctrl+Shift+R 强制刷新，避免缓存旧 `index.html` / `term-session.js`）。

- [ ] **Step 3: 手动验证（覆盖 spec 测试清单）**
  1. 终端内鼠标选中一段文本 → 点底部 `Ctrl+C` 按钮：选区内容进入剪贴板、选区被清除、终端**未**中断（无 `\x03` 效果）。
  2. 选中文本 → 打开「发按键」面板、拼出并点 `Ctrl+C`：同上。
  3. 选中文本 → 在终端内按键盘 Ctrl+C：同上。
  4. **无选区**时，分别用上述三种方式发 Ctrl+C：终端正常收到中断（如终止正在运行的命令 / 出现 `^C`）。
  5. 安卓真机（HTTPS）重复 1–4，确认复制成功（验证 `navigator.clipboard` 主路径）。

- [ ] **Step 4: 无提交**
本任务无代码改动，不提交。若验证发现问题，回到对应 Task 修复并单独 commit。

---

### Task 5: 更新 AGENTS.md 已知注意事项

**Files:**
- Modify: `AGENTS.md`（在「已知注意事项」末尾追加一条，编号顺延）

**Interfaces:**
- Produces: 文档记录

- [ ] **Step 1: 在 AGENTS.md 已知注意事项末尾追加**
在最后一条（当前为 33. 直接发送快捷键面板「发按键」）之后追加：
```
34. **Ctrl+C 选区复制（2026-07-12 引入）**：当 xterm 存在选区时，三种发送路径（键盘 onData / 底部快捷键按钮 / 发按键面板）的 Ctrl+C 都改为**复制选区到剪贴板并清除选区**，不再发送中断 `\x03`；无选区时 Ctrl+C 仍正常发 `\x03` 中断。纯前端改动（`public/index.html` + `public/term-session.js`），不动 `server.js`、不加 WebSocket 消息。复制函数：`copyToClipboard`（优先 `navigator.clipboard.writeText`，失败/不可用走 `fallbackCopy` 隐藏 textarea + `execCommand('copy')` 兜底）、`copyTermSelection(term)`（复制 + `term.clearSelection()`，挂 `window` 供 term-session.js 调用）、`sendInputMaybeCopy(data)`（仅拦截 `\x03`）。键盘路径在 `term-session.js` 的 `onData` 用 `this.term.hasSelection()` 判定；按钮与面板改调 `sendInputMaybeCopy`。行为始终开启，无设置开关。
```

- [ ] **Step 2: 提交**
```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 记录 Ctrl+C 选区复制行为"
```

---

## 自审

- **Spec 覆盖**：三条路径（键盘 / 底部按钮 / 发按键面板）均有对应 Task（3 / 2 / 2）；剪贴板主路径+兜底（Task 1）；清除选区（Task 1 `copyTermSelection`）；始终开启无开关（Global Constraints + Task 1）；纯前端不动 server（Global Constraints）。✓
- **占位符扫描**：无 TBD/TODO/"类似 Task N"。所有代码步骤均含完整代码。✓
- **类型一致性**：`copyTermSelection(term)` 在 Task 1 定义并挂 `window.copyTermSelection`，Task 3 以 `window.copyTermSelection(this.term)` 调用，签名一致；`sendInputMaybeCopy(data)` 在 Task 1 定义，Task 2 两处调用，参数一致。✓
