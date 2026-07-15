# 设置弹窗勾选框即时应用设计

日期：2026-07-15

## 背景

设置弹窗里有若干通过勾选框设置的选项，每个选项后还跟着一个「应用」按钮。用户认为对勾选框而言这个按钮是多余的——勾选/取消勾选本身就应即时生效，不必再点一下「应用」。

## 范围

仅针对设置弹窗中的 **3 个勾选框**，数值类 `input[type=number]` 输入框及其「应用」按钮保持不变（用户只提到勾选框）。

| 设置项 | 全局变量 | WS 消息 type |
|--------|----------|--------------|
| 显示滚动按钮 | `showScrollButtons` | `show_scroll_buttons` |
| 通知声音 | `bellSoundEnabled` | `bell_sound_enabled` |
| 通知 Toast | `bellToastEnabled` | `bell_toast_enabled` |

## 改动内容（纯前端 `public/index.html`）

1. **删除 3 个「应用」按钮**：从每行 checkbox 后的 DOM 中移除 `<button class="btn-primary" id="btn-apply-..." onclick="applySettings...()">应用</button>`。

2. **checkbox 挂 `onchange` 即时发送**：在 3 个 checkbox 上加 `onchange="applySettingsShowScrollButtons()"` / `applySettingsBellSoundEnabled()` / `applySettingsBellToastEnabled()`。toggle 即触发原 apply 函数。

3. **apply 函数逻辑不变，仅改反馈方式**：`applySettingsShowScrollButtons` / `applySettingsBellSoundEnabled` / `applySettingsBellToastEnabled` 内部仍只读 `checked` → `wsSend`（服务端权威，本地状态由接收侧 broadcast 后更新，符合 AGENTS.md 注意事项 28）。把内部 `fbBtn('btn-apply-...', true)` 改为新增 helper `flashHint(spanId)`：在 checkbox 旁的小 `<span class="apply-hint">` 显示 `✓已应用`，1.5s 后清空。

4. **新增 DOM span**：每个 checkbox 行在 checkbox 后加 `<span id="hint-showScrollButtons" class="apply-hint"></span>` / `hint-bellSoundEnabled` / `hint-bellToastEnabled`。

5. **CSS**：新增 `.apply-hint { color:#4caf50; font-size:12px; margin-left:8px; }`（复用现有绿色，与 `fbBtn` 一致）。

### helper 设计

```js
function flashHint(spanId) {
    const el = document.getElementById(spanId);
    if (!el) return;
    el.textContent = '✓已应用';
    setTimeout(() => { if (el) el.textContent = ''; }, 1500);
}
```

## 行为预期

勾选/取消 → 立即 `wsSend` → 接收侧广播更新本地状态 + 记前端日志 → checkbox 旁闪「✓已应用」。多端同步不受影响（服务端权威）。

## 不改动的部分

- `server.js`：无新消息、无协议变更。
- 数值类输入框（缓冲区上限、日志上限、clientTailMax、滚动间隔、滑动阈值、BEL 防抖/蜂鸣时长、大/小尺寸）维持「应用」按钮模式。
- 接收侧 `ws.onmessage` 处理器：本就更新本地变量 + 记日志，无需改动。

## 性能影响

- 零新增事件监听器（用 inline `onchange`）。
- 每行 1 个 `<span>` 节点，常量级、不可测。
- 零网络变化（复用既有 WS 消息）。
- 接收侧日志本已存在，无新增开销。

## 验收

- 刷新网页，开设置弹窗。
- 勾选/取消「显示滚动按钮」「通知声音」「通知 Toast」中任一项：
  - checkbox 旁出现「✓已应用」并 1.5s 后消失。
  - 前端日志出现对应「…同步为 显示/隐藏」「…开启/关闭」。
  - 其他客户端同步变化（服务端权威）。
- 「应用」按钮不再出现在上述 3 行。
- 纯前端改动，无需重启后端。
