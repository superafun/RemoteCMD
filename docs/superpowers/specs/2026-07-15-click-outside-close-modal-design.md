# 点空白处关闭所有 modal-overlay 弹窗

日期：2026-07-15
状态：已批准（设计通过）

## 背景

当前所有弹窗（`modal-overlay > modal-box` 结构）都只有一个底部「关闭」按钮。
用户希望点击弹窗以外的遮罩空白区域也能关闭弹窗，减少一次"找关闭按钮"的点击。

范围经用户确认：**所有 `modal-overlay` 弹窗都生效**，不只设置弹窗。

## 机制

给每个 `modal-overlay` 的 `<div>` 加一个 `onclick`，判断点到的是 overlay 本身
（而非里面的 `modal-box` 或任何子元素）才执行关闭：

```js
onclick="if(event.target===this) <对应的关闭函数/表达式>()"
```

`event.target === this` 保证只有"点空白遮罩"触发；点在弹窗内部任意元素（标题、
输入框、按钮、滚动区）都会冒泡到 `modal-box` 而非 overlay，不会误关。

## 改动清单（全在 `public/index.html`）

5 个弹窗的 overlay 起始 div 各加一行 onclick：

| 弹窗 | 行 | 改动 |
|------|-----|------|
| 设置弹窗 `openSettingsModal` | L159 | `'<div class="modal-overlay" onclick="if(event.target===this)closeSettingsModal()">'` |
| 日志弹窗 `openLogModal` | L302 | `'<div class="modal-overlay" onclick="if(event.target===this)this.remove()">'` |
| 发按键面板 `openSendKeysPanel` | L1141 | `'<div class="modal-overlay" style="z-index:1000;" onclick="if(event.target===this)closeSendKeysPanel()">'` |
| 快捷键编辑 `openHotkeyEditor` | L1284 | `'<div class="modal-overlay" onclick="if(event.target===this)closeEditor()">'` |
| 可用按键 `showAvailableKeys` | L1399 | `'<div class="modal-overlay" style="z-index:1000;" onclick="if(event.target===this)this.remove()">'` |

各弹窗按其既有关闭函数兜底：
- 设置 → `closeSettingsModal()`（null `settingsDiv` 句柄）
- 发按键 → `closeSendKeysPanel()`（null `sendKeysPanel` + `activeMods.clear()`）
- 快捷键编辑 → `closeEditor()`（null `editorDiv` 句柄）
- 日志 / 可用按键 → 无全局句柄，直接 `this.remove()`，与现有底部关闭按钮行为一致

## 不改动

- 底部「关闭」按钮保留（点按钮关仍可）。
- `styles.css` 不改动。
- `server.js` 不改动，不加 WebSocket 消息，不加协议。
- 现有各弹窗的关闭函数内部逻辑完全不动。

## 层级 / 嵌套安全

发按键面板、可用按键弹窗是 `z-index:1000`，盖在基础弹窗（`z-index:999`）之上。
点顶层弹窗的遮罩只关顶层，不会穿透误关下方弹窗（下方 overlay 收不到该 click）。
- 设置弹窗打开后点「日志」会先 `closeSettingsModal()` 再开日志，二者不同时存在。
- 快捷键编辑打开后点「可用按键」会叠加在上层；此时点空白只关可用按键，符合预期。

## 性能 / 影响

- 每个 overlay 仅新增 1 个 inline onclick（无新增监听器、无 DOM 节点、无布局/回流变化）。
- inline `onclick` 沿用现有弹窗写法（与底部关闭按钮同一风格），零新增抽象。
- 纯前端改动，刷新网页即生效，不改服务器、不重启。

## 验收

1. 打开设置弹窗，点遮罩空白处 → 弹窗关闭。
2. 打开日志/快捷键编辑/发按键/可用按键弹窗，点遮罩空白处 → 对应弹窗关闭。
3. 点弹窗内部（标题、输入框、按钮、滚动区）不会误关。
4. 底部「关闭」按钮仍正常工作。
5. 快捷键编辑上叠加可用按键时，点空白只关可用按键、不关编辑弹窗。
