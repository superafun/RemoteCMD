# Ctrl+C 选区复制设计文档

- 日期：2026-07-12
- 范围：纯前端改动，不涉及 `server.js` / WebSocket 协议

## 需求

当 xterm 终端上存在被选中的文本时，发送 Ctrl+C（来自以下任意路径）应当**复制选中文本到剪贴板并清除选区**，而不是把中断信号 `\x03` 发给服务端；当不存在选区时，Ctrl+C 仍按原行为发送 `\x03` 中断当前命令。

纳入的路径（用户确认全部覆盖）：

1. **键盘** —— 用户在终端内按 Ctrl+C。
2. **底部快捷键按钮栏** —— 点击预设的 `Ctrl+C` 按钮。
3. **发按键面板** —— 在「发按键」弹窗里拼出并点 `Ctrl+C`。

## 决策（用户确认）

- 三条发送路径统一纳入同一逻辑。
- 剪贴板写入：`navigator.clipboard.writeText` 优先，失败或不可用时退回隐藏 `textarea` + `execCommand('copy')`。`navigator.clipboard` 仅在 secure 上下文（HTTPS 或 localhost）可用；用户实际环境为 HTTPS（含安卓真机走 HTTPS 访问），clipboard API 可用，`execCommand` 兜底仅作为防御性保险，不依赖它主路径生效。
- 复制完成后**清除** xterm 选区（`term.clearSelection()`）。
- 行为**始终开启**，不做设置开关。

## 方案

采用方案 A：统一拦截 + 共享复制函数。仅拦截 Ctrl+C 字节 `\x03`，其他按键/序列完全不受影响。

### 1. 新增 `copyToClipboard(text)`（index.html 全局）

优先异步 `navigator.clipboard.writeText`，`catch` 或 `navigator.clipboard` 不存在时退回 `fallbackCopy`。

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
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}
```

### 2. 新增 `copyTermSelection(term)`（index.html 全局，暴露给 term-session.js）

```js
function copyTermSelection(term) {
  const sel = term.getSelection();
  if (sel) copyToClipboard(sel);
  term.clearSelection();
}
window.copyTermSelection = copyTermSelection;
```

### 3. 新增 `sendInputMaybeCopy(data)`（index.html 全局）

仅当待发送数据为 `\x03` 且当前活动会话有选区时复制，否则走原 `sendInput`。

```js
function sendInputMaybeCopy(data) {
  if (data === '\x03') {
    const s = sessions.get(activeId);
    if (s && s.term.hasSelection()) { copyTermSelection(s.term); return; }
  }
  sendInput(data);
}
```

### 4. term-session.js 键盘路径修改

> **⚠️ 实现修正（2026-07-12，实测后）**：原方案在 `term.onData` 回调里用 `this.term.hasSelection()` 拦截 Ctrl+C，**无效**。原因：xterm.js 在处理按键时会**先清掉选区再触发 `onData`**，所以 `onData` 执行时 `hasSelection()` 已为 `false`，永远判定为「无选区」→ 直接发 `\x03` 中断。底部按钮/面板走 `sendInputMaybeCopy`（不进 `onData`，选区仍在）所以有效，暴露出此差异。
>
> **正确做法**：用 `wrapper` 上的**捕获阶段 `keydown` 监听**抢在 xterm 清选区前拦截。判定 `e.ctrlKey && !e.shiftKey && !e.altKey && (e.key==='c'||e.key==='C') && term.hasSelection()`，命中则 `preventDefault()` + `stopPropagation()` + `copyTermSelection(term)`。`onData` 恢复为原样直接 `wsSend`（Ctrl+C 已被 keydown 拦截，不会到达）。

`TermSession` 构造内：

```js
// 输入转发到服务端（onData 不再拦截，键盘 Ctrl+C 改由下方 keydown 捕获处理）
this.term.onData(data => {
  wsSend({ type: 'input', id: this.id, data });
});

// 键盘 Ctrl+C：有选区时复制并吞掉，不发给服务端（捕获阶段，先于 xterm 清选区）
this.wrapper.addEventListener('keydown', e => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey &&
      (e.key === 'c' || e.key === 'C') && this.term.hasSelection()) {
    e.preventDefault();
    e.stopPropagation();
    if (window.copyTermSelection) window.copyTermSelection(this.term);
  }
}, true);
```

### 5. 调用点替换

- `public/index.html` 底部快捷键渲染处（`btn.onclick`）：
  `btn.onclick = () => sendInput(hotkeys[name]);`
  → `btn.onclick = () => sendInputMaybeCopy(hotkeys[name]);`
- `public/index.html` 发按键面板 `pickAndSend` 内：
  `sendInput(parseHotkey(name));`
  → `sendInputMaybeCopy(parseHotkey(name));`

## 数据流

```
用户选中文本，按/点 Ctrl+C
  │
  ├─ 键盘 → wrapper 捕获阶段 keydown 监听（先于 xterm 清选区）
  │        └─ ctrl+c && term.hasSelection() 真 → preventDefault + stopPropagation
  │              → copyTermSelection(term) → 复制+清除选区，onData 不再收到该键
  │        └─ 假（无选区）→ 不拦截，xterm 正常处理 → onData('\x03') → wsSend 中断
  │
  ├─ 底部按钮 → sendInputMaybeCopy('\x03')
  │        └─ activeId 会话 hasSelection() 真 → copyTermSelection
  │        └─ 假 → sendInput('\x03')
  │
  └─ 发按键面板 → sendInputMaybeCopy(parseHotkey('Ctrl+C')='\x03')
           └─ 同上
```

## 性能影响

- 每个 `TermSession` 新增 1 个捕获阶段 `keydown` 监听器（无选区时 `hasSelection()` 为 O(1) 早退，无额外开销）；`onData` 无新增逻辑。
- `term.hasSelection()` 为 O(1)；`getSelection()` / `clearSelection()` 仅在每次触发 Ctrl+C 时执行，开销可忽略。
- 纯前端改动，不重启服务器，刷新页面即可生效。

## 测试

用安卓真机走 HTTPS 访问，验证：

1. 选中文本后，点击底部 `Ctrl+C` 按钮 → 选区内容进入剪贴板、选区被清除、终端未被中断。
2. 选中文本后，在「发按键」面板拼出并点 `Ctrl+C` → 同上。
3. 选中文本后，在终端内按键盘 Ctrl+C → 同上。
4. 无选区时，上述三种方式发送 Ctrl+C → 终端正常收到中断（`\x03`）。
5. `fallbackCopy` 兜底路径（可在非 secure 上下文临时验证；用户主环境为 HTTPS，clipboard API 已可用，兜底仅作保险）。

## 不纳入范围

- 不新增设置开关（用户确认始终开启）。
- 不改动服务端、不新增 WebSocket 消息类型。
- 不处理除 Ctrl+C 外的其它复制组合（如 Ctrl+Insert），保持 YAGNI。
