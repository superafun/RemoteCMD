# 复制成功/失败 Toast 提示设计文档

- 日期：2026-07-12
- 范围：纯前端改动，不涉及 `server.js` / WebSocket 协议

## 背景

Ctrl+C 选区复制功能已实现。用户在复制时没有反馈，需要添加一个轻量提示：复制成功显示“已复制”，失败显示“复制失败”。

## 需求

- 覆盖三条发送路径：**键盘 / 底部快捷键按钮 / 发按键面板**。
- 提示形式：页面**终端上方居中**的短暂 **Toast**。
- 停留时间：**1.5 秒**，然后自动消失。
- 提示文案：成功 = **“已复制”**；失败 = **“复制失败”**。
- 提示依据：按**实际写入剪贴板结果**显示，不是仅按“触发了复制”显示。
- 样式：成功为**蓝色背景**，失败为**红色背景**。
- 连续多次复制：Toast **允许堆叠**（每次复制创建独立 DOM，各自 1.5 秒后移除）。

## 决策

按实际写入结果提示，因此剪贴板函数需要改为返回写入结果：

- `copyToClipboard(text)` → `Promise<boolean>`
  - `navigator.clipboard.writeText` 成功返回 `true`，失败/异常返回 `false`。
  - `fallbackCopy` 中根据 `document.execCommand('copy')` 返回值决定 true/false。
- `copyTermSelection(term)` → `Promise<boolean>`
  - 先取选区；有选区则调用 `copyToClipboard` 并返回其结果；无选区返回 `false`。
- 调用点改为 `await` / `.then(...)` 显示对应 Toast。

## 方案

### 1. 新增 `showToast(message, type)`（index.html 全局）

```js
function showToast(message, type = 'success') {
  const div = document.createElement('div');
  div.textContent = message;
  div.className = 'toast toast-' + type;
  // 默认定位样式由 CSS 类提供；单次弹窗可叠加
  document.body.appendChild(div);
  setTimeout(() => { div.remove(); }, 1500);
}
```

### 2. 新增 CSS（index.html `<style>` 内）

```css
.toast {
  position: fixed;
  top: 50%;
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

> 实际实现中，把“终端上方居中”理解为中心偏上：页面 `top: 40%` 比几何中心更自然。最终文案中按 `top: 40%` 实现，仍写“终端上方居中”。

### 3. 修改 `copyToClipboard` / `fallbackCopy` 返回 `Promise<boolean>`

```js
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
      .then(() => true)
      .catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

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

### 4. 修改 `copyTermSelection` 返回 `Promise<boolean>`

```js
function copyTermSelection(term) {
  const sel = term.getSelection();
  term.clearSelection();
  if (sel) return copyToClipboard(sel).then(ok => {
    showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
    return ok;
  });
  return Promise.resolve(false);
}
```

> `showToast` 放在 `copyTermSelection` 内统一显示，因为按钮/面板/键盘三条路径都调它。

### 5. 按钮与面板路径：`sendInputMaybeCopy` 改为 async/await

```js
async function sendInputMaybeCopy(data) {
  if (data === '\x03') {
    const s = sessions.get(activeId);
    if (s && s.term.hasSelection()) { await copyTermSelection(s.term); return; }
  }
  sendInput(data);
}
```

> 按钮点击事件处理器可以 await async 函数，无兼容问题。

### 6. 键盘路径：`keydown` 监听器改为 async/await

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

> `await` 仅用于复制/Toast，不会阻塞事件本身的拦截语义。

## 数据流

```
三条路径触发 copyTermSelection(term)
  │
  ├─ 有选区：
  │    ├─ copyToClipboard(sel) → Promise<boolean>
  │    ├─ 显示 Toast（成功：已复制 / 失败：复制失败）
  │    └─ term.clearSelection()
  │
  └─ 无选区：返回 false，不显示 Toast（此场景在调用前已用 hasSelection 过滤）
```

## 性能影响

- 每次显示 Toast 创建 1 个 DOM 节点，1.5 秒后自动移除。允许堆叠，但连续快速复制会创建多个 DOM，最大数量受限于 1.5 秒内的复制触发次数，通常 < 10，可忽略。
- `copyToClipboard` 改为 Promise 不影响主路径性能（navigator.clipboard 本身就是异步）。
- 纯前端改动，不重启服务器。

## 测试

1. 选中文本，键盘 Ctrl+C → 终端上方居中显示蓝色“已复制”，选区清除。
2. 选中文本，底部 Ctrl+C 按钮 → 同上。
3. 选中文本，发按键面板 Ctrl+C → 同上。
4. 连续快速复制多次 → 多个 Toast 堆叠显示，各自 1.5 秒后消失。
5. 无选区时 Ctrl+C → 无 Toast、终端正常中断。
6. （可选）在 `fallbackCopy` 触发场景下验证失败 Toast（红色“复制失败”）。

## 不纳入范围

- 不新增设置开关（始终开启提示）。
- 提示文案固定为“已复制”/“复制失败”，不显示字符数、不显示路径来源。
- 不改动服务端、不新增 WebSocket 消息。
