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

`TermSession` 构造内的 `term.onData` 回调增加拦截：Ctrl+C 且自身 term 有选区时复制并 `return`，否则照旧 `wsSend`。用 `this.term` 判断选区（焦点所在会话，比 `activeId` 更精确）；无选区时仍按原 `this.id` 发送。

```js
this.term.onData(data => {
  if (data === '\x03' && this.term.hasSelection()) {
    if (window.copyTermSelection) window.copyTermSelection(this.term);
    return;
  }
  wsSend({ type: 'input', id: this.id, data });
});
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
  ├─ 键盘 → term.onData('\x03')
  │        └─ term.hasSelection() 真 → copyTermSelection(term) → 复制+清除选区，不发服务端
  │        └─ 假 → wsSend('\x03')  （原行为，中断）
  │
  ├─ 底部按钮 → sendInputMaybeCopy('\x03')
  │        └─ activeId 会话 hasSelection() 真 → copyTermSelection
  │        └─ 假 → sendInput('\x03')
  │
  └─ 发按键面板 → sendInputMaybeCopy(parseHotkey('Ctrl+C')='\x03')
           └─ 同上
```

## 性能影响

- 零新增事件监听器、零轮询。
- `term.hasSelection()` 为 O(1)；`getSelection()` / `clearSelection()` 仅在每次触发 Ctrl+C 时执行，开销可忽略。
- 纯前端改动，不重启服务器，刷新页面即可生效。

## 测试

用安卓真机走 LAN HTTP 访问，验证：

1. 选中文本后，点击底部 `Ctrl+C` 按钮 → 选区内容进入剪贴板、选区被清除、终端未被中断。
2. 选中文本后，在「发按键」面板拼出并点 `Ctrl+C` → 同上。
3. 选中文本后，在终端内按键盘 Ctrl+C → 同上。
4. 无选区时，上述三种方式发送 Ctrl+C → 终端正常收到中断（`\x03`）。
5. `fallbackCopy` 兜底路径（可在非 secure 上下文临时验证；用户主环境为 HTTPS，clipboard API 已可用，兜底仅作保险）。

## 不纳入范围

- 不新增设置开关（用户确认始终开启）。
- 不改动服务端、不新增 WebSocket 消息类型。
- 不处理除 Ctrl+C 外的其它复制组合（如 Ctrl+Insert），保持 YAGNI。
