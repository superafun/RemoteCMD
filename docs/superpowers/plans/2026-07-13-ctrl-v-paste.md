# Ctrl+V 粘贴修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 终端里的 `Ctrl+V` 像右键"粘贴"一样把系统剪贴板内容写进 PTY。

**Architecture:** 在现有 capture-phase `keydown` 监听（`term-session.js`，现用于 Ctrl+C 选区复制）里追加 `Ctrl+V` 分支，拦截后调 `pasteFromClipboard(term, id)` 读剪贴板并写进 PTY。与 Ctrl+C 复制完全对称，纯前端，不动后端。

**Tech Stack:** xterm.js v6（隐藏 textarea + 捕获阶段 keydown）、`navigator.clipboard.readText()`、`wsSend`（既有 input 通道）。

## Global Constraints

- 仅拦截 `Ctrl+V`（不含 `Ctrl+Shift+V` / `Shift+Insert`）。
- `Ctrl+V` 全局生效：所有场景（含普通 PowerShell）都变为"粘贴"语义，覆盖原"原样输入 `^V`"。
- 成功粘贴**不**弹 Toast；仅读取剪贴板失败时弹红色 Toast「粘贴失败(无法访问剪贴板)」。
- 换行归一化：`\r\n`→`\r`，单 `\n`→`\r`（与 xterm 默认 paste 一致）。
- 用 `id` 直接发送，避免切会话串台。
- 必须在捕获阶段 `preventDefault()` + `stopPropagation()`，否则 `\x16` 仍发往 PTY。
- 纯前端；**不动 `server.js`、不加 WebSocket 消息、不改协议**；刷新网页即生效。

---

## 文件结构

- `public/index.html`：新增 `pasteFromClipboard(term, id)` 函数 + `window.pasteFromClipboard` 全局句柄（仿现有 `copyTermSelection`）。
- `public/term-session.js`：扩展 capture-phase `keydown` 监听，追加 `Ctrl+V` 分支。
- `AGENTS.md`：新增一条注意事项（项目规则要求功能变更后同步更新）。

---

### Task 1: 新增 pasteFromClipboard（public/index.html）

**Files:**
- Modify: `public/index.html`（紧接 `window.copyTermSelection = copyTermSelection;` 之后，约第 838 行）

**Interfaces:**
- Consumes: `wsSend(obj)`（既有）、`showToast(text, type)`（既有）
- Produces: `window.pasteFromClipboard(term, id)`（全局函数，Task 2 调用）

- [ ] **Step 1: 在 index.html 中 `window.copyTermSelection = copyTermSelection;` 之后插入粘贴函数**

```js
        // === Ctrl+V 粘贴 ===
        // 读取系统剪贴板并写进 PTY，模拟右键"粘贴"行为。
        // 与 Ctrl+C 选区复制对称：复制是写剪贴板，粘贴是读剪贴板。
        // 换行归一化与 xterm 默认 paste 一致（\r\n→\r，\n→\r），
        // 使 TUI 把换行解释为确认而非字段内换行。
        async function pasteFromClipboard(term, id) {
            let text = null;
            if (navigator.clipboard?.readText) {
                try { text = await navigator.clipboard.readText(); } catch (e) { text = null; }
            }
            if (text == null) { showToast('粘贴失败(无法访问剪贴板)', 'error'); return; }
            text = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
            if (text) wsSend({ type: 'input', id, data: text });
        }
        window.pasteFromClipboard = pasteFromClipboard;
```

- [ ] **Step 2: 本地校验语法**

在浏览器按 F12 打开控制台，刷新页面后应无任何报错；在控制台执行 `typeof window.pasteFromClipboard` 期望输出 `"function"`。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 新增 pasteFromClipboard 粘贴函数"
```

---

### Task 2: 扩展 capture-phase keydown 监听（public/term-session.js）

**Files:**
- Modify: `public/term-session.js:38-45`（现有 `this.wrapper.addEventListener('keydown', ...)` 块）

**Interfaces:**
- Consumes: `window.pasteFromClipboard(term, id)`（Task 1 产出）、`window.copyTermSelection(term)`（既有）
- Produces: 无（行为变更，由 Task 4 手动验收）

- [ ] **Step 1: 用下方代码替换现有 `keydown` 监听块**

替换前：

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

替换后：

```js
        // 键盘 Ctrl+C：有选区时复制并吞掉，不发给服务端（见注意事项 34）。
        // 键盘 Ctrl+V：粘贴系统剪贴板内容，覆盖 xterm 默认的 \x16 转发（见注意事项 38）。
        // 二者都必须在捕获阶段拦截——xterm 处理按键时若先动作，默认行为会抢先。
        this.wrapper.addEventListener('keydown', async e => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'c' || e.key === 'C') && this.term.hasSelection()) {
                e.preventDefault();
                e.stopPropagation();
                if (window.copyTermSelection) await window.copyTermSelection(this.term);
                return;
            }
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                e.stopPropagation();
                if (window.pasteFromClipboard) await window.pasteFromClipboard(this.term, this.id);
            }
        }, true);
```

- [ ] **Step 2: 本地校验**

刷新页面，按 F12 控制台应无报错。确认 Ctrl+C 选区复制仍正常（回归，不影响既有分支）。

- [ ] **Step 3: Commit**

```bash
git add public/term-session.js
git commit -m "feat: 捕获阶段拦截 Ctrl+V 触发粘贴"
```

---

### Task 3: 更新 AGENTS.md 注意事项

**Files:**
- Modify: `AGENTS.md`（注意事项区块末尾，接第 37 条之后）

**Interfaces:**
- Consumes: 无
- Produces: 无（文档同步，项目规则要求）

- [ ] **Step 1: 在 AGENTS.md 注意事项第 37 条后追加第 38 条**

```markdown
38. **Ctrl+V 粘贴（2026-07-13 引入）**：捕获阶段 `keydown` 监听（现用于 Ctrl+C 复制，见注意事项 34）中新增 Ctrl+V 分支——拦截 `Ctrl+V`（`preventDefault` + `stopPropagation`），调 `pasteFromClipboard(term, id)` 读系统剪贴板并写进 PTY，覆盖 xterm 默认的 `\x16` 转发。**根因**：右键"粘贴"走 xterm 默认 `paste` 事件（读剪贴板链路）所以通；Ctrl+V 被 xterm 当键盘字符 `\x16` 吞掉并 `preventDefault` 掉浏览器原生 paste 事件，所以失效。**范围**：仅 `Ctrl+V`（不含 `Ctrl+Shift+V` / `Shift+Insert`），全局生效（含普通 PowerShell 变粘贴语义），成功不弹 Toast、仅失败时弹红色「粘贴失败(无法访问剪贴板)」。换行归一化 `\r\n`→`\r`、单 `\n`→`\r`（与 xterm 默认 paste 一致）。用 `this.id` 直接发避免切会话串台。纯前端改动（`public/index.html` 新增 `pasteFromClipboard` + `public/term-session.js` 扩展监听），不动 `server.js`、不加 WebSocket 消息、不加协议，刷新即生效。安全上下文：`localhost`/`https` 可用 `navigator.clipboard.readText()`；仅"局域网 IP + http"拿不到，降级为失败 Toast（浏览器限制，无读取兜底）。
```

- [ ] **Step 2: Commit 并通知用户**

```bash
git add AGENTS.md
git commit -m "docs: 新增 Ctrl+V 粘贴注意事项"
```

Commit 后**必须**告知用户：AGENTS.md 已新增第 38 条 Ctrl+V 粘贴注意事项。

---

### Task 4: 手动验收（浏览器）

**Files:** 无（验收步骤）

**Interfaces:** 无

前置：本项目无测试框架，验收为浏览器手动操作。改的是纯前端，确认服务器在跑后直接刷新网页即可（AGENTS.md 工作流：只改前端不要重启服务器）。

- [ ] **Step 1: 确认后端在跑**

```powershell
Get-NetTCPConnection -LocalPort 65433
```

期望：有监听记录（若未在跑，按项目纪律用 `npm start` 而非 taskkill 重启）。

- [ ] **Step 2: 普通 PowerShell 下按 Ctrl+V**

浏览器打开终端，复制一段文本到系统剪贴板，在 PowerShell 提示符下按 `Ctrl+V`。
期望：剪贴板文本被粘贴进终端（覆盖原 `^V` 行为）。

- [ ] **Step 3: TUI 程序内按 Ctrl+V**

进入一个 TUI 程序，按 `Ctrl+V`。
期望：正常粘贴，效果与右键菜单"粘贴"一致。

- [ ] **Step 4: 右键"粘贴"回归**

在任意位置右键 → "粘贴"。
期望：仍正常（未被破坏）。

- [ ] **Step 5: Ctrl+C 选区复制回归**

选中终端文字后按 `Ctrl+C`。
期望：仍复制选区并清空选区（既有分支未受影响）。

- [ ] **Step 6: 空剪贴板**

清空系统剪贴板（或复制空内容）后按 `Ctrl+V`。
期望：无异常、无空输入发送。

- [ ] **Step 7: 非安全上下文降级**

用"局域网 IP + http"（非 localhost/非 https）访问时按 `Ctrl+V`。
期望：弹红色 Toast「粘贴失败(无法访问剪贴板)」，页面不崩溃。

- [ ] **Step 8: 移动端（Android HTTPS 真机）**

真机按 `Ctrl+V`（软键盘组合键或外接键盘）粘贴。
期望：正常粘贴。

---

## 自审结论

- Spec 覆盖：全部约束（仅 Ctrl+V / 全局 / 成功不弹 Toast / 换行归一化 / 用 id 发 / capture+preventDefault / 纯前端）均有对应任务；AGENTS.md 同步（Task 3）满足项目规则；7 项验收（Spec 测试验收）映射到 Task 4。
- 占位符扫描：无 TBD/TODO，每步含实际代码与命令。
- 类型一致性：`pasteFromClipboard(term, id)` 在 Task 1 定义、Task 2 以 `pasteFromClipboard(this.term, this.id)` 调用，签名一致；`wsSend` / `showToast` 为既有接口。
