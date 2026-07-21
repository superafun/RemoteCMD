# 选区模式移动端触摸选区（设计文档）

- 日期：2026-07-21
- 状态：设计已批准，待实现
- 关联：记忆 `project_selection_mode.md`（根因 + 实证结论已记录）

## 1. 背景与目标

`选区模式`（`index.html` 的 `toggleSelectMode` / `term-session.js` 的 `enableNativeSelection`，采用方法一：进入时 `term.write` 发 DECRST 关 xterm 鼠标追踪，退出时发 DECSET 恢复）在**桌面端**可用鼠标拖选，但**移动端**触摸拖拽无法选区。

**目标**：让移动端在选区模式下也能用手指拖拽选中终端文字，且复制按钮 / `Ctrl+C` 照常工作；不引入 NaN 垃圾、不破坏现有滑动滚动与双指缩放。

## 2. 根因（已 Playwright 真机触摸仿真实证）

- xterm 6.1.0-beta.290 默认是 DOM 渲染器（文本是真实 DOM span），但选区由 `SelectionService` 用**鼠标事件**（mousedown/mousemove/mouseup）画覆盖层，不是浏览器原生选区（`.xterm { user-select: none }`）。
- 触摸事件**不会**被翻译成 xterm 选区。实测三种 `touch-action`（`pan-x`/`auto`/`manipulation`）下触摸拖拽 `term.hasSelection()` 全为 `false`；真实鼠标拖拽为 `true`。
- 尝试"触摸→合成 `MouseEvent`"失败：xterm 忽略非信任（untrusted）合成鼠标事件。
- 这不是本项目 CSS/逻辑错误，是 xterm 库行为。

## 3. 方案

选区模式下，用现有**捕获阶段**触摸监听（`onTouchScrollStart/Move/End`）直接驱动 xterm 的 `term.select()` 选区 API，不靠浏览器原生选区、不靠合成鼠标事件。

### 3.1 坐标换算（像素 → 单元格）

```
cell  = term._core._renderService.dimensions.css.cell   // 内部 API，取值前守卫非空
rect  = term.element.getBoundingClientRect()
col   = floor((clientX - rect.left) / cell.width)       // 横向无滚动，无需加视口偏移
rowVis= floor((clientY - rect.top)  / cell.height)
row   = term.buffer.active.viewportY + rowVis           // 加视口滚动偏移得到缓冲区行
col   = clamp(col, 0, term.cols - 1)
row   = clamp(row, 0, term.buffer.active.length - 1)
```

### 3.2 选区更新

- `touchstart`（单指）：记下起点单元格，`term.select(c, r, 0)`（折叠光标）。
- `touchmove`（单指）：算起止单元格，规范化顺序（保证起点在左上），`len = (r2-r1)*cols + (c2-c1) + 1`，调 `term.select(c1, r1, len)` 实时画选区。
- `touchend/touchcancel`：清起点，选区保留（供复制）。

`term.select()` 产生的是**真 xterm 选区**，`term.hasSelection()` / `term.getSelection()` 直接可用——现有复制按钮、`Ctrl+C` 复制处理器（`term-session.js` 捕获阶段 keydown）**无需改动**。

### 3.3 与现有触摸栈的衔接（关键：一条代码路径，既选中又杜绝 NaN）

改动只在 `onTouchScrollStart/Move/End` 的 `selectionMode` 分支内，**非选区分支逐字不动**。

- **选区模式 + 单指**：不再 `return` 早退；改为「算单元格 → `term.select()` → `stopPropagation()`」。`stopPropagation()` 在捕获阶段拦掉 xterm 的 `Gesture` 文档监听（冒泡阶段），使其无法把触摸当滚动上报 → 不产生 `ESC[<65;NaN;NaNM` 垃圾。
- **选区模式 + 多指（≥2）**：走现有双指逻辑——`stopPropagation()` 但**绝不 `preventDefault`**，让浏览器按 `touch-action: pinch-zoom` 执行原生双指缩放，不干扰选区。
- **非选区模式**：保持现有单指滑动滚动（`smartScroll`）与多指缩放拦截逻辑完全不变。

> 注意：选区模式本就用 `DECRST` 关掉了 xterm 鼠标追踪，即使不拦截 xterm 手势也不会发滚动 SGR；这里 `stopPropagation` 是双保险，进一步确保零 NaN。

## 4. 涉及文件

- `public/index.html`
  - `onTouchScrollStart`（约 L1303）：`if (selectionMode) { ...单指→select+stopPropagation；多指→原逻辑... }` 取代原 `if (selectionMode) return;`。
  - `onTouchScrollMove`（约 L1329）：选区模式下单指分支改为驱动 `term.select`；多指/非选区不变。
  - `onTouchScrollEnd`（约 L1354）：选区模式下清选区起点；多指/非选区不变。
  - 新增一个小辅助：从触摸点算单元格 + 活动会话 `term`（`sessions.get(activeId)?.term`）的 getter，含 `term._core` 空值守卫。

其余文件（`styles.css`、`term-session.js`、`server.js`）**不改**。

## 5. 验证（实现后必做，量化对比）

用与排查相同的 Playwright 仿真（已落 `repro_touch_integ.*`，实现后删）做量化对比，验收标准：

1. **选区模式 + 单指拖（向下 / 向上反向）**：`term.hasSelection() === true`，`term.getSelection()` 文本正确 → 问题解决。
2. **选区模式 + 单指拖 / 双指全程**：`term.onData` 抓取 `ESC[<` 串，`garbageCount === 0` → 无 NaN 垃圾。
3. **非选区模式 + 单指拖**：`hasSelection === false` 且 `smartScroll` 触发次数与改动前一致 → 无回归、滑动滚动照常。
4. **双指（选区/非选区）**：`hasSelection === false`、无垃圾、不崩溃；原生缩放不被 `preventDefault` 吃掉。

桌面端鼠标拖选走原路径，不受影响（仅触摸监听会触发，鼠标事件不进 `touchstart`）。

## 6. 范围与取舍（YAGNI）

- 不做浏览器原生选区（`touch-action`/`user-select` 改动）——会破坏 `term.getSelection()` 复制链路。
- 不合成鼠标事件——xterm 忽略 untrusted 事件。
- 不改动非选区模式的滑动 / 缩放逻辑。
- `term._core` 为内部 API，仅在取值处加空值守卫，不引入抽象封装。
