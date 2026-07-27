# 任务实现报告：设置弹窗 3 个勾选框改为即时应用

## 状态
DONE

## 改动 commit hash
`abbcaf01c9b6f68a93bdf1bf763f67341e3ad0ce`

## 改动文件
- `public/index.html`（纯前端）
  - 改动 A/B：设置弹窗 HTML 中「显示滚动按钮 / 通知声音 / 通知 Toast」3 个 checkbox 块，移除「应用」按钮，改为 `onchange` 即时触发 apply 函数，并各加一个 `<span id="hint-..." class="apply-hint"></span>`。
  - 改动 C：在 `fbBtn` 之后新增 `flashHint(spanId)` helper。
  - 改动 D：3 个 apply 函数（`applySettingsShowScrollButtons` / `applySettingsBellSoundEnabled` / `applySettingsBellToastEnabled`）内 `fbBtn('btn-apply-...', true)` 改为 `flashHint('hint-...')`，仍只读 checked 后 `wsSend`，服务端权威、本地状态由接收侧更新。
- `public/styles.css`（纯前端）
  - 在 `.modal-row + .modal-row` 规则后追加 `.apply-hint` 样式（绿色、`12px`、`margin-left:8px`）。

未改动 `server.js`，未新增任何 WebSocket 消息，未重启服务器。

## 自检结果
1. ✅ `public/index.html` 中已不存在 `btn-apply-showScrollButtons` / `btn-apply-bellSoundEnabled` / `btn-apply-bellToastEnabled` 任一字符串（按钮已删、fbBtn 调用已改完）。
2. ✅ `flashHint` 已定义（L370），3 个 apply 函数均调用了对应 `flashHint('hint-...')`（L419 / L465 / L471）。
3. ✅ 数值类输入框（缓冲区上限 / 日志上限 / clientTailMax / 滚动间隔 / 滑动阈值 / BEL 防抖 / 蜂鸣时长 / 大/小尺寸）的「应用」按钮保持原样未动，仍走 `fbBtn` 反馈。

## 顾虑
- 无。改动与既有"勾选框即时应用、用瞬时 ✓已应用 替代按钮反馈"的偏好一致；checkbox 触发点为 `onchange`，勾选/取消均会即时 `wsSend`，满足需求。
- 仅前端改动，浏览器刷新即生效，无需后端重启。
