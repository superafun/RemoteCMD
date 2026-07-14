# 触摸滑动模拟鼠标滚轮滚动（MVP）

- 日期：2026-07-14
- 状态：设计已批准，待写实现计划
- 范围：**仅触摸滑动手势**，不动现有 4 个滚动按钮

## 背景与目标

当前 web 终端在安卓真机上没有鼠标滚轮，滚动只能靠底部按钮。底部按钮分两类（上/下滑动**终端** = 发 SGR 给 PTY；上/下滑动**页面** = 滚 xterm 视口），在 TUI 和普通命令行下各自只有一类可用（详见 AGENTS.md 关于滚动的机制说明）。用户希望：

1. **理想（本次目标）**：在终端区域**上下滑动手指**模拟鼠标滚轮，TUI 和普通命令行都能正常滚动，从而省去点按钮。
2. **后续再定**：滑动手感验证有效后，再决定是否把 4 个按钮合并成 2 个（共用同一个 `smartScroll` 内核）。本次**不做**按钮合并。

设计原则（来自用户反馈"先最小可测版验证再扩展"）：先把"滑动能否正确模拟滚轮、且不与选区冲突"这个核心假设用最小改动验证，真机试手感，有效后再扩展（合并按钮、调阈值等）。

## 核心机制

真实鼠标滚轮在 xterm 里是两条路自动切换（已读 xterm v6 源码确认）：
- TUI 开了鼠标追踪（`DECSET 1002/1003`）：滚轮被 xterm 翻译成 SGR 序列 `ESC[<64;y;1M` 写进 PTY，由 TUI 自己滚（xterm 视口不动）。
- 普通命令行（鼠标追踪关）：滚轮由 xterm 自己处理，滚 xterm 视口看历史。

本次新增一个 `smartScroll(dir)`，逻辑与真实鼠标滚轮完全一致，供滑动手势调用：

```js
function smartScroll(dir) {            // dir: -1 上滑（看更早内容）, +1 下滑
  const s = sessions.get(activeId);
  if (!s) return;
  if (s.term.modes.mouseTrackingMode !== 'none')  // TUI 鼠标追踪开启
    s.sendSgrWheel(dir);             // 发 SGR 序列给 PTY，TUI 自己滚
  else
    s.scrollLines(dir);              // 普通 CLI：xterm 滚视口看历史
}
```

依赖均已现成：`TermSession.sendSgrWheel()`（public/term-session.js:159）、`TermSession.scrollLines()`（term-session.js:133）、`term.modes.mouseTrackingMode`（选区模式代码已用过，index.html:144）。

## 实现要点

### 1. `smartScroll(dir)` 函数
位置：`public/index.html` 现有 `scrollUp/scrollDown/scrollXtermUp/scrollXtermDown`（约 865-869 行）旁边新增。不替换现有 4 个按钮函数，仅新增供手势调用。

### 2. 触摸滑动监听 `setupTouchScroll()`
在 `document` 上以**捕获阶段**挂 `touchstart/touchmove/touchend/touchcancel` 监听。捕获阶段早于 xterm 自己的冒泡阶段 `document` 触摸监听（xterm 的选区监听挂在 `document` 冒泡），因此在判定为"滚动手势"后可 `stopPropagation()` 截住，xterm 不会把这次手势当成选区。

**前置守卫（任一不满足则直接放行，不处理）：**
- 当前活动 touch 必须是**单指**（多指视为缩放/选区，不滚动）。
- `e.target` 落在终端区域内：`e.target.closest('#terminal-container')` 为真（底部栏 `#hotkeys-bar`/`.toolbar` 在 `#terminal-container` 之外，不受影响，横滑底部栏仍由现有逻辑处理）。
- **选区模式未开启**：`if (selectionMode) return;`（选区模式是全局布尔，index.html:371，已镜像到 `window.selectionMode`）。开启时让 xterm 原生拖选正常工作，滑动完全不介入。

**状态变量**：`touchId`（当前处理的触点 identifier，null=无）、`swipeActive`（本次手势是否已判定为滚动）、`startX/startY`、`lastY`、`accum`（累计纵向位移）。

**`touchstart`**：满足守卫且为单指 → 记录 `touchId = changedTouches[0].identifier`、`startX/Y`、`lastY = startY`、`accum = 0`、`swipeActive = false`。**不** `preventDefault`（让轻点聚焦 / 长按选区照常）。

**`touchmove`**：
- 若 `touchId === null` 或当前触点 identifier 不匹配 → 返回。
- 若 `!swipeActive`：算 `dy = curY - startY`、`dx = curX - startX`；当 `|dy| > CLASSIFY(初定 10px)` **且** `|dy| > |dx|`（纵向占优，是竖滑不是横滑）→ 判定 `swipeActive = true`、`accum = 0`、`lastY = curY`；否则返回（放行给 xterm：轻点/长按选区/横滑）。
- 若 `swipeActive`：`e.preventDefault(); e.stopPropagation();`；`dyStep = curY - lastY; accum += dyStep; lastY = curY`；
  - `accum >= THRESHOLD` → 反复 `smartScroll(+1); accum -= THRESHOLD`（`THRESHOLD` 初定 24px，真机调）；
  - `accum <= -THRESHOLD` → 反复 `smartScroll(-1); accum += THRESHOLD`。

**`touchend`/`touchcancel`**：`touchId = null; swipeActive = false;` 复位。

符号约定：手指**上滑**（curY 减小 → accum 负）→ `smartScroll(-1)` 看更早内容；手指**下滑** → `smartScroll(+1)`。与所有 App 的自然滚动手感一致。

### 3. CSS：`touch-action`
给终端元素加 `touch-action: pan-x`（`.terminal-wrapper` 或 `.xterm`，实现时确认 xterm 是否覆盖）。作用：浏览器只接管**横向**手势（如返回），**纵向**留给 JS 处理，避免页面被纵向带动；同时纵向手势仍会向 JS 派发 `touchmove`（touch-action 只影响浏览器默认滚动/缩放，不影响事件派发）。这样 `preventDefault` 只在判定为滚动时调用即可。

### 4. 初始化
`DOMContentLoaded` 或连接建立处调用一次 `setupTouchScroll()`（监听挂在 document 上，全局只挂一次，不随会话增删重复挂）。

## 边界与冲突处理

| 场景 | 行为 |
|------|------|
| TUI 中滑动 | `smartScroll` 发 SGR → TUI 自己滚（与真实滚轮一致） |
| 普通 CLI 滑动 | `smartScroll` 滚 xterm 视口看历史 |
| 选区模式开启时滑动 | 手势禁用，xterm 原生拖选正常 |
| 轻点 / 长按选词 | 未达 `CLASSIFY` 阈值，放行给 xterm，正常聚焦/选区 |
| 横滑（如浏览器返回） | 纵向不占优，不判定为滚动，放行 |
| 多指 | 不处理（忽略第二指），避免误滚/缩放冲突 |
| 无活动会话 | `smartScroll` 内 `if (!s) return` 兜底 |
| 输入条展开、发按键面板打开 | 滑动在终端区域仍可触发（终端在底层），互不影响 |
| 右键粘贴 / Ctrl+V / 发按键 / 合并按钮 | 现有路径不变；本次未触碰按钮 |

## 性能影响分析

- **DOM 操作**：零。滑动过程只调 `smartScroll`（发 WebSocket input 或调 `term.scrollLines`），无节点增删、无样式变更。
- **事件监听**：`document` 上新增 1 个捕获阶段监听（4 类 touch 事件共用同一函数），所有 touchmove 都会进该函数，但首行是廉价 `target`/`selectionMode` 守卫（失败即返回），开销可忽略（与现有底部栏 `pointerdown` 全局监听同量级）。
- **`smartScroll` 调用频率**：每累计 `THRESHOLD`(24px) 才调一次，一次快滑约几次，远低于每帧一次；`sendSgrWheel` 发一条 `input` 消息、`scrollLines` 调 xterm 内部方法，无额外开销。
- **`stopPropagation` 范围**：仅在 `swipeActive` 后调用，且只截当前手势的 touch 事件，不阻塞其他事件/其他元素。
- **内存**：状态变量为函数级闭包，无泄漏。
- 结论：对桌面/移动端性能无可见影响。

## 测试验收（需用户安卓真机验证手感）

1. **TUI**：打开 `vim`/`less`/`htop` 等开鼠标追踪的程序，在终端区上下滑动 → TUI 内容跟随滚动。
2. **普通 CLI**：在普通 PowerShell 提示符下输出大量内容，上下滑动 → xterm 视口历史跟随滚动。
3. **手感**：阈值 `THRESHOLD=24px`、`CLASSIFY=10px` 是否顺手，真机反馈后调。
4. **选区模式**：开启后滑动不触发滚动，长按拖选文字正常。
5. **不误伤**：底部栏横滑、按钮点击、输入框、轻点聚焦均不受影响。

## 不在本次范围

- 4 个滚动按钮合并为 2 个（手感验证后再议）。
- 任何 `server.js` / WebSocket 协议 / `config.json` 变更（纯前端）。
- 滑动灵敏度设置项（如需再做）。

## 后续扩展方向（待本次验证后）

- 若手感 OK：把 4 按钮合并为 2（`▲上滑`/`▼下滑` 调 `smartScroll`），保留 `▽到底页面`；"按住滚动间隔"两项按当前模式自适应（TUI 用终端间隔、CLI 用页面间隔）。
