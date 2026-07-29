# 复制成功/失败 Toast 提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 Ctrl+C 选区复制成功或失败时，在终端上方居中显示一个 1.5 秒自动消失的 Toast；成功显示蓝底“已复制”，失败显示红底“复制失败”；覆盖键盘 / 底部按钮 / 发按键面板三条路径；按实际写入结果提示。

**Architecture:** 纯前端改动。`copyToClipboard` / `fallbackCopy` 改为返回 `Promise<boolean>`；`copyTermSelection` 返回 `Promise<boolean>` 并在内部统一显示 Toast；`sendInputMaybeCopy` 和 `term-session.js` 的 keydown 拦截改为 `await` 调用。新增 `showToast(message, type)` 与对应 CSS 类。

**Tech Stack:** 浏览器原生 JS、xterm.js v6。

## Global Constraints

- 纯前端改动，不动 `server.js`、不加 WebSocket 消息。
- 三条发送路径（键盘 / 底部快捷键按钮 / 发按键面板）都要提示。
- 提示显示在终端上方居中（实现用 `top: 40%` 左右），停留 1.5 秒后自动消失，允许堆叠。
- 成功文案固定为“已复制”，失败文案固定为“复制失败”。
- 按实际写入剪贴板结果显示（非仅按触发）。
- 行为始终开启，不新增设置开关。
- 每次代码修改完成必须立即 `git commit`，禁止 `git add -A`；单变更一个 commit；单 `main` 分支直接提交。
- 项目无测试框架，验证为静态检查 + 用户手动真机验证。

---

## 文件结构

| 文件 | 改动 | 职责 |
|------|------|------|
| `public/index.html` | 修改 | 新增 `showToast` + CSS；改 `copyToClipboard` / `fallbackCopy` / `copyTermSelection` 返回 `Promise<boolean>` 并显示 Toast；`sendInputMaybeCopy` 改为 async |
| `public/term-session.js` | 修改 | keydown 拦截器的 `copyTermSelection` 调用前加 `await` |
| `AGENTS.md` | 修改 | 更新第 34 条，补充 Toast 提示相关说明 |

---

### Task 1: 新增 showToast 与 CSS

**Files:**
- Modify: `public/index.html`（CSS 区 + 全局函数区，见 Step 1/2 定位）

**Interfaces:**
- Produces: `showToast(message: string, type: 'success' | 'error'): void` —— 创建 Toast DOM，1.5 秒后自动移除，允许堆叠。
- Produces: CSS 类 `.toast` / `.toast-success` / `.toast-error` —— 固定定位、居中、蓝/红底白字。

- [ ] **Step 1: 在 index.html 的 `<style>` 内追加 Toast 样式**

定位 `<style>` 末尾，在 `</style>` 之前追加：

```css
/* Toast 提示：复制成功/失败 */
.toast {
    position: fixed;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 8px 16px;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    z-index: 2000;
    pointer-events: none;
    opacity: 0.95;
}
.toast-success { background: #2d6cdf; }
.toast-error   { background: #d9534f; }
```

- [ ] **Step 2: 在 index.html 全局函数区新增 `showToast`**

在 `copyToClipboard` / `copyTermSelection` 等函数附近（或 `sendInput` 之后）插入：

```js
        // 显示短暂 Toast 提示（1.5s 自动消失，允许堆叠）
        function showToast(message, type = 'success') {
            const div = document.createElement('div');
            div.textContent = message;
            div.className = 'toast toast-' + type;
            document.body.appendChild(div);
            setTimeout(() => { div.remove(); }, 1500);
        }
```

- [ ] **Step 3: 验证**
打开 `public/index.html`：
1. CSS 区末尾有 `.toast` / `.toast-success` / `.toast-error` 三个规则。
2. `showToast` 定义在全局作用域，且只创建一次 DOM、设一次 `setTimeout`。

- [ ] **Step 4: 提交**
```bash
git add public/index.html
git commit -m "feat: 新增 Toast 提示组件与样式"
```

---

### Task 2: copyToClipboard / fallbackCopy 返回 Promise<boolean>

**Files:**
- Modify: `public/index.html`（替换既有 `copyToClipboard` 和 `fallbackCopy`）

**Interfaces:**
- Consumes: 无（Task 1 的 `showToast` 在 Task 3 才会使用）
- Produces: `copyToClipboard(text: string): Promise<boolean>`、`fallbackCopy(text: string): boolean`

- [ ] **Step 1: 替换 `copyToClipboard` 和 `fallbackCopy`**

定位既有代码（类似）：

```js
        function copyToClipboard(text) {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
        }
        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            const prevFocus = document.activeElement;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            ta.remove();
            if (prevFocus && prevFocus.focus) prevFocus.focus();
        }
```

替换为：

```js
        // 复制到剪贴板：优先 navigator.clipboard，失败/不可用退回 execCommand 兜底
        function copyToClipboard(text) {
            if (navigator.clipboard?.writeText) {
                return navigator.clipboard.writeText(text)
                    .then(() => true)
                    .catch(() => fallbackCopy(text));
            }
            return Promise.resolve(fallbackCopy(text));
        }

        // 非 secure 上下文兜底（用户环境为 HTTPS，此路径仅作保险）
        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            const prevFocus = document.activeElement;
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            ta.remove();
            if (prevFocus && prevFocus.focus) prevFocus.focus();
            return ok;
        }
```

- [ ] **Step 2: 验证**
1. `copyToClipboard` 两个分支都返回 `Promise<boolean>`。
2. `fallbackCopy` 返回 `ok`（`execCommand` 结果）。
3. 焦点恢复逻辑保留（`prevFocus`）。

- [ ] **Step 3: 提交**
```bash
git add public/index.html
git commit -m "feat: copyToClipboard 与 fallbackCopy 返回写入结果"
```

---

### Task 3: copyTermSelection 显示 Toast 并返回 Promise<boolean>

**Files:**
- Modify: `public/index.html`（替换既有 `copyTermSelection`）

**Interfaces:**
- Consumes: `showToast(message, type)`（Task 1 产出）、`copyToClipboard(text)`（Task 2 产出）
- Produces: `copyTermSelection(term: Terminal): Promise<boolean>` —— 清除选区并显示对应 Toast

- [ ] **Step 1: 替换 `copyTermSelection`**

定位既有代码：

```js
        function copyTermSelection(term) {
            const sel = term.getSelection();
            if (sel) copyToClipboard(sel);
            term.clearSelection();
        }
        window.copyTermSelection = copyTermSelection;
```

替换为：

```js
        // 复制终端选区并清除选区，返回 Promise<boolean>（供键盘路径 term-session.js 调用）
        function copyTermSelection(term) {
            const sel = term.getSelection();
            term.clearSelection();
            if (sel) {
                return copyToClipboard(sel).then(ok => {
                    showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
                    return ok;
                });
            }
            return Promise.resolve(false);
        }
        window.copyTermSelection = copyTermSelection;
```

- [ ] **Step 2: 验证**
1. `copyTermSelection` 返回 `Promise<boolean>`。
2. 成功时调用 `showToast('已复制', 'success')`，失败时 `showToast('复制失败', 'error')`。
3. `window.copyTermSelection` 仍挂出。

- [ ] **Step 3: 提交**
```bash
git add public/index.html
git commit -m "feat: copyTermSelection 返回结果并显示 Toast"
```

---

### Task 4: sendInputMaybeCopy 改为 await copyTermSelection

**Files:**
- Modify: `public/index.html`（替换既有 `sendInputMaybeCopy`）

**Interfaces:**
- Consumes: `copyTermSelection(term)`（Task 3 产出，返回 Promise<boolean>）

- [ ] **Step 1: 替换 `sendInputMaybeCopy`**

定位既有代码：

```js
        function sendInputMaybeCopy(data) {
            if (data === '\x03') {
                const s = sessions.get(activeId);
                if (s && s.term.hasSelection()) { copyTermSelection(s.term); return; }
            }
            sendInput(data);
        }
```

替换为：

```js
        async function sendInputMaybeCopy(data) {
            if (data === '\x03') {
                const s = sessions.get(activeId);
                if (s && s.term.hasSelection()) { await copyTermSelection(s.term); return; }
            }
            sendInput(data);
        }
```

- [ ] **Step 2: 验证**
1. 函数声明改为 `async function`。
2. 命中复制时 `await copyTermSelection(s.term)` 并 `return`。
3. 未命中时仍走 `sendInput(data)`。

- [ ] **Step 3: 提交**
```bash
git add public/index.html
git commit -m "feat: 按钮与面板路径 await copyTermSelection 以显示 Toast"
```

---

### Task 5: 键盘路径 await copyTermSelection

**Files:**
- Modify: `public/term-session.js`（调整 keydown 监听函数）

**Interfaces:**
- Consumes: `window.copyTermSelection(term)`（Task 3 产出，返回 Promise<boolean>）

- [ ] **Step 1: 调整 keydown 监听函数**

定位既有代码（类似）：

```js
        this.wrapper.addEventListener('keydown', e => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'c' || e.key === 'C') && this.term.hasSelection()) {
                e.preventDefault();
                e.stopPropagation();
                if (window.copyTermSelection) window.copyTermSelection(this.term);
            }
        }, true);
```

替换为：

```js
        this.wrapper.addEventListener('keydown', async e => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'c' || e.key === 'C') && this.term.hasSelection()) {
                e.preventDefault();
                e.stopPropagation();
                if (window.copyTermSelection) await window.copyTermSelection(this.term);
            }
        }, true);
```

- [ ] **Step 2: 验证**
1. 监听函数改为 `async` 箭头函数。
2. `await window.copyTermSelection(this.term)` 等待复制/Toast 完成，不阻塞事件拦截（已经 `preventDefault`/`stopPropagation` 在前）。

- [ ] **Step 3: 提交**
```bash
git add public/term-session.js
git commit -m "feat: 键盘 Ctrl+C 路径 await copyTermSelection 以显示 Toast"
```

---

### Task 6: 浏览器/真机验证（手动，无代码改动）

**Files:** 无代码改动

- [ ] **Step 1: 刷新页面**
在连 <端口> 的浏览器中 Ctrl+Shift+R 强制刷新，加载新 `index.html` / `term-session.js`。

- [ ] **Step 2: 手动验证**
1. 选中文本 → 键盘 Ctrl+C：页面中央显示蓝底“已复制”，选区清除，终端未中断。
2. 选中文本 → 底部 `Ctrl+C` 按钮：同上。
3. 选中文本 → 发按键面板拼出 Ctrl+C：同上。
4. 连续快速复制多次：多个 Toast 堆叠显示，各自 1.5 秒后消失。
5. 无选区时 → 三种方式 Ctrl+C：无 Toast，终端正常中断。
6. （可选）触发 `fallbackCopy` 场景：验证红底“复制失败”能显示。

- [ ] **Step 3: 无提交**
本任务无代码改动。

---

### Task 7: 更新 AGENTS.md 已知注意事项

**Files:**
- Modify: `AGENTS.md`（更新第 34 条，补充 Toast 提示）

**Interfaces:**
- Produces: 文档记录

- [ ] **Step 1: 更新第 34 条内容**

定位 AGENTS.md 第 34 条（当前已存在 Ctrl+C 选区复制条目），把原有内容扩展为包含 Toast：

```
34. **Ctrl+C 选区复制 + Toast 提示（2026-07-12 引入）**：当 xterm 存在选区时，三种发送路径（键盘 / 底部快捷键按钮 / 发按键面板）的 Ctrl+C 都改为**复制选区到剪贴板并清除选区**，不再发送中断 `\x03`；无选区时 Ctrl+C 仍正常发 `\x03` 中断。复制成功时在终端上方居中显示蓝底 Toast「已复制」，复制失败时显示红底 Toast「复制失败」，停留 1.5 秒后自动消失，允许堆叠。纯前端改动（`public/index.html` + `public/term-session.js`），不动 `server.js`、不加 WebSocket 消息。`copyToClipboard` / `fallbackCopy` 返回实际写入结果（`Promise<boolean>`），`copyTermSelection` 内部统一显示 Toast。键盘路径用 `term-session.js` 构造里的 `wrapper` 捕获阶段 `keydown` 监听拦截；按钮与面板改调 `sendInputMaybeCopy`。行为始终开启，无设置开关。
```

- [ ] **Step 2: 提交**
```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 记录 Ctrl+C 复制 Toast 提示"
```

---

## 自审

- **Spec 覆盖**：
  - 三条路径都提示：键盘（Task 5）、按钮（Task 4）、面板（Task 4）都 `await copyTermSelection`，Toast 在 `copyTermSelection` 内统一显示。✓
  - 终端上方居中 Toast 1.5 秒：Task 1 CSS + `showToast` 实现。✓
  - 文案固定：Task 3 `showToast('已复制'/'复制失败')`。✓
  - 按实际写入结果：Task 2 `copyToClipboard`/`fallbackCopy` 返回 boolean。✓
  - 成功蓝底/失败红底：Task 1 CSS `.toast-success`/`.toast-error`。✓
  - 允许堆叠：Task 1 `showToast` 每次创建独立 DOM。✓
- **占位符扫描**：无 TBD/TODO/"类似 Task N"；所有代码步骤含完整代码。✓
- **类型一致性**：
  - `copyToClipboard` 返回 `Promise<boolean>`（Task 2）→ `copyTermSelection` 返回 `Promise<boolean>`（Task 3）→ `sendInputMaybeCopy` 改为 `async` 并 `await`（Task 4）→ keydown 监听改为 `async` 并 `await`（Task 5）。✓
