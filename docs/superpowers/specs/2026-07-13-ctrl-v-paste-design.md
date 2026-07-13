# Ctrl+V 粘贴修复设计

日期：2026-07-13
状态：已批准（待实现）

## 问题

在 RemoteCMD 的 Web 终端里，某些 TUI 程序中 `Ctrl+V` 无法粘贴文字，但右键菜单点"粘贴"可以正常粘贴。

## 根因

粘贴这件事从头到尾是**浏览器/前端**在做，PTY 里的程序（包括 TUI）完全不参与：

- 终端程序活在"字符流"协议后面，**拿不到操作系统剪贴板**。所谓"粘贴"真实发生的是：前端 JS 读系统剪贴板 → 把文本当成字符写进 PTY。程序只看到一段字符流。
- **右键粘贴能用**：xterm.js 默认在隐藏 `textarea` 上监听浏览器 `paste` 事件。点菜单"粘贴" → 浏览器把剪贴板文本塞进 textarea → `paste` 事件触发 → xterm 把文本写进 PTY。这条链路走"读剪贴板"，不经过键盘，所以通。
- **Ctrl+V 失效**：在 xterm 里它先是 `keydown` 键盘事件。xterm.js 的键盘处理把 `Ctrl+V` 当成控制字符 `0x16`（`\x16`）发给 PTY，并在 keydown 阶段 `preventDefault`，把浏览器原生"粘贴→paste 事件"一并挡掉。PTY 只收到一串 `\x16`，TUI 不认识（也读不到剪贴板），自然不粘贴。右键那条 `paste` 事件链路没被触发。

结论：右键走"读剪贴板"链路；Ctrl+V 被 xterm 当键盘字符吞了，没去读剪贴板。

## 范围确认（与用户对齐）

- 仅拦截 `Ctrl+V`（不含 `Ctrl+Shift+V` / `Shift+Insert`）。
- `Ctrl+V` 全局生效：在所有场景（含普通 PowerShell）都变为"粘贴"语义，覆盖原"原样输入 `^V`"含义，与本地 Windows Terminal 行为一致。
- 成功粘贴不弹 Toast（文本已直接出现在终端，避免噪音）；仅在读取剪贴板失败时弹红色 Toast。

## 方案

**方案 A（采用）：在现有捕获阶段 keydown 监听里加 Ctrl+V 分支**

`public/term-session.js` 的 capture-phase `keydown` 监听（原用于 Ctrl+C 选区复制，`term-session.js:38`）中追加 `Ctrl+V` 分支：拦截 → 调 `pasteFromClipboard(term, id)`。与 Ctrl+C 复制完全对称，零新依赖、纯前端、不动 `server.js`。

（已排除方案 B：xterm `attachCustomKeyEventHandler`，与现有 capture 模式不统一、更复杂；方案 C：放行 Ctrl+V 到原生 `paste` 事件，因 xterm 已 `preventDefault` 无法可靠放行。）

## 设计细节

### 1. 新增 `pasteFromClipboard(term, id)`（public/index.html，仿 `copyTermSelection`）

```js
async function pasteFromClipboard(term, id) {
    let text = null;
    if (navigator.clipboard?.readText) {
        try { text = await navigator.clipboard.readText(); } catch (e) { text = null; }
    }
    if (text == null) { showToast('粘贴失败(无法访问剪贴板)', 'error'); return; }
    // 换行归一化，与 xterm 默认 paste 一致：\r\n→\r，\n→\r
    text = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    if (text) wsSend({ type: 'input', id, data: text });
}
window.pasteFromClipboard = pasteFromClipboard;
```

要点：
- 用 `id`（TermSession 的 `this.id`）直接发，避免切会话串台；与 `copyTermSelection(term)` 的传参风格一致。
- 换行归一化 `\r\n`→`\r`、单 `\n`→`\r`，与 xterm.js 默认 `paste` 处理一致，使 TUI 把换行解释为确认。
- 安全上下文：`localhost` 与 `https://` 均可使用 `navigator.clipboard.readText()`；仅"局域网 IP + http"拿不到，降级为失败 Toast。浏览器限制，无可靠读取兜底（区别于 copy 的 `execCommand` 兜底）。

### 2. 扩展捕获阶段监听（public/term-session.js:38）

在现有 `Ctrl+C` 分支之后追加 `Ctrl+V` 分支：

```js
// Ctrl+V 粘贴（覆盖原 \x16 转发）
if (e.ctrlKey && !e.shiftKey && !e.altKey &&
    (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    e.stopPropagation();
    if (window.pasteFromClipboard) await window.pasteFromClipboard(this.term, this.id);
}
```

- 必须 `preventDefault()`，否则 `\x16` 仍会发往 PTY。
- 必须 `stopPropagation()`，阻止事件继续冒泡到 xterm 默认处理。
- 与 Ctrl+C 同处 capture 阶段，原因相同（见注意事项 34）：xterm 处理按键时会先清选区/做默认处理，捕获阶段拦截最稳。

### 3. Toast 反馈

仅失败时弹红色 Toast「粘贴失败(无法访问剪贴板)」，1.5s 后自动消失（复用现有 `showToast`）。成功不提示。

### 4. 兼容性 / 边界

- 选区模式（方法一，`enableNativeSelection`/`disableNativeSelection`）下 Ctrl+V 仍可正常粘贴，与选区复制互不冲突。
- 剪贴板为空时 `text === ''`，跳过 `wsSend`，不发送空输入。
- 不改 `server.js`、不加 WebSocket 消息、不改协议。纯前端改动，刷新网页即生效。
- 大段粘贴：整段作为一个 `input` 消息一次性发送（与真实终端粘贴一致，区别于"输入条"的逐字符模拟敲键）。

## 性能影响

- 新增 1 个捕获阶段 keydown 分支判断（每次按键一次布尔判断，O(1)，可忽略）。
- 新增 `pasteFromClipboard` 为按需调用（仅按 Ctrl+V 时），含一次 `navigator.clipboard.readText()` 异步调用 + 一次 `wsSend`。无新增监听器、无新增 DOM、无布局/回流影响。
- 粘贴文本通过现有 `wsSend` 路径发送，复用既有通道。

## 测试验收

1. 普通 PowerShell 提示符下按 `Ctrl+V`：应把系统剪贴板文本粘贴进终端（覆盖原 `^V` 行为）。
2. TUI 程序（如开启鼠标追踪/括号粘贴模式的程序）内按 `Ctrl+V`：应正常粘贴，效果与右键菜单"粘贴"一致。
3. 右键"粘贴"仍正常（回归，不应被破坏）。
4. `Ctrl+C` 选区复制仍正常（回归，capture 阶段另一分支应不受影响）。
5. 剪贴板为空时按 `Ctrl+V`：无异常、无空输入发送。
6. 非安全上下文（局域网 IP + http）下按 `Ctrl+V`：弹红色「粘贴失败(无法访问剪贴板)」Toast，不崩溃。
7. 移动端（Android HTTPS 真机）按 `Ctrl+V`（软键盘组合键或外接键盘）：应正常粘贴。

## 涉及文件

- `public/index.html`：新增 `pasteFromClipboard` 函数 + `window.pasteFromClipboard` 全局句柄。
- `public/term-session.js`：capture-phase `keydown` 监听扩展 Ctrl+V 分支。
