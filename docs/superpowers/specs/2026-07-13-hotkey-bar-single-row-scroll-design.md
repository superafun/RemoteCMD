# 底部快捷键栏单行化 + 横向溢出滚动（2026-07-13）

## 背景与目标

当前底部快捷键栏 `#hotkeys-bar` 是 `flex-wrap: wrap`，其内部的 `#hotkeysList` 也是 `flex-wrap: wrap`。
当快捷键数量较多时，按钮会折行成多行，挤占终端纵向空间，移动端尤其明显。

目标：把所有底部按钮固定在一行（不换行），超宽时直接溢出屏幕右侧，通过横向滑动（移动端手指横滑 / 桌面端横向滚动条）把需要的按钮带回可视区。
**不改 DOM 层级、不改 server.js、不新增 WebSocket 消息、不新增 JS 事件。**

## 决策（已与用户确认）

1. **滑动范围**：整个 `#hotkeys-bar` 作为一条横向滚动条，`发按键` / `输入条` / 快捷键按钮 / `编辑` / 滚动按钮组 **全部一起随滑动移出屏幕**（不钉住左侧）。
2. **滚动方式**：纯 CSS `overflow-x: auto` 原生溢出滚动。移动端手指左右滑动；桌面端出现横向滚动条，用 Shift+滚轮 / 轨迹板左右滚。不新增左右箭头按钮。

## 实现方案

### 改动 1：`#hotkeys-bar` 容器（styles.css）
原规则 `.toolbar, #hotkeys-bar { display:flex; flex-wrap:wrap; gap:0; align-items:center; }` 拆分：
- `.toolbar` 保持 `flex-wrap: wrap`（顶栏不受影响）。
- `#hotkeys-bar` 改为：
  ```css
  #hotkeys-bar {
      display: flex;
      flex-wrap: nowrap;       /* 不换行，单行 */
      overflow-x: auto;        /* 超宽横向溢出可滚动 */
      gap: 0;
      align-items: center;
      touch-action: pan-x;     /* 移动端授权横向 pan，禁掉竖向误滚 */
  }
  ```

### 改动 2：`#hotkeysList`（styles.css + index.html 内联）
- styles.css 中 `#hotkeysList { flex: 1 1 0; min-width: 0; }` 改为 `flex: 0 0 auto;`（按内容真实宽度排列，不撑满、不挤压，超宽才溢出）。
- index.html 中 `#hotkeysList` 的内联 `style="display:flex;gap:0;flex-wrap:wrap;"` 把 `flex-wrap:wrap` 改为 `flex-wrap: nowrap`。

### 改动 3：底部栏按钮不压缩（styles.css）
在 `.toolbar button, #hotkeys-bar button { min-width: 60px; }` 基础上，给 `#hotkeys-bar button` 追加 `flex-shrink: 0; white-space: nowrap;`：
- `flex-shrink: 0`：不被 flex 压缩，保持真实宽度。
- `white-space: nowrap`：按钮文字（如「新建终端」「Shell」）不折行。
- `#scrollGroup button` 已有 `min-width: 0`（按内容收缩），保持不动，其 `flex-shrink` 也设为 0 即可（继承 `#hotkeys-bar button` 规则）。
- `#sendKeysBtn` / `#inputBarBtn` 已有 `flex-shrink: 0`，保持。

### 改动 4：滚动按钮组位置（保持现状）
`#scrollGroup` 的 `margin-left: auto` 保持不变：快捷键少时把编辑+滚动组推到右侧对齐；快捷键多导致溢出时该 auto 无剩余空间、紧贴编辑按钮之后，行为正确，无需改动。

### 改动 5：输入条模式（不动）
点「输入条」展开时 `hotkeysList` 隐藏、`#inputBarWrap`（`flex: 1 1 0`）独占整行，此模式本就无溢出，逻辑原样保留。

## 移动端滚动可用性（风险点与兜底）

现有一行全局 `pointerdown` 拦截（`document.addEventListener('pointerdown', ... if (e.target.closest('button')) e.preventDefault())`），用于防止按钮抢焦点导致软键盘收回。
手指从按钮上起滑时，该 `preventDefault` 可能干扰 touch 滚动起始。

**兜底手段**：`#hotkeys-bar { touch-action: pan-x }` 明确授权该容器横向 pan，浏览器据此放行横向滚动，不受按钮 `preventDefault` 影响。
**不动那条全局 pointerdown handler**，避免破坏其他按钮（含输入条发送后交还终端焦点）的焦点行为。

真机验收标准：在 Android 真机上，手指无论落在按钮还是按钮间隙，都可从右向左横滑把最右侧的「编辑 / 滚动按钮」拉回屏幕内，松手后停住不回弹。

## 性能 / 影响分析

- **DOM**：零新增 / 零删除节点。
- **事件监听器**：零新增。
- **协议**：零变更（不动 server.js / WebSocket）。
- **布局 / 回流**：仅 CSS 规则变化，一次性静态布局；横向滚动由浏览器原生合成层处理，不触发终端重绘或 WebSocket 流量。
- **内存**：无新增开销。

## 验收方式

1. 桌面端：打开网页，快捷键较多时底部栏应为单行、出现横向滚动条；Shift+滚轮可左右滚动。
2. 移动端（Android 真机）：底部栏单行，手指横滑可滚动；`touch-action: pan-x` 确保从按钮上起滑也能滚动。
3. 输入条模式：点「输入条」展开，输入条独占整行、无溢出滚动，发送/收起后恢复单行按钮栏。
4. 快捷键少时：单行、无滚动条、编辑+滚动组靠右（margin-left:auto 生效）。
