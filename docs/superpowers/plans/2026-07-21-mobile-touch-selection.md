# 选区模式移动端触摸选区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让移动端在「选区模式」下用手指拖拽即可选中终端文字（驱动 xterm 的 `term.select()`），不引入 NaN 垃圾、不破坏现有滑动滚动与双指缩放。

**Architecture:** 仅改动 `public/index.html` 的捕获阶段触摸监听 `onTouchScrollStart/Move/End`。选区模式下不再 `return` 早退，单指改为「算单元格 → `term.select()` 画选区 → `stopPropagation()` 拦掉 xterm 手势处理器（杜绝 NaN）」；多指仍走原双指缩放拦截逻辑。非选区分支与 `styles.css`/`term-session.js`/`server.js` 完全不动。

**Tech Stack:** 前端原生 JS（xterm.js 6.1.0-beta.290 公共 API `term.select(col,row,len)` / `term.hasSelection()` / `term.getSelection()`；内部 API `term._core._renderService.dimensions.css.cell`，需空值守卫）。

## Global Constraints

- 只改 `public/index.html`；不改 `styles.css`、`term-session.js`、`server.js`。
- 非选区模式的单指滑动滚动与多指缩放拦截逻辑**逐字不变**。
- `term._core` 为内部 API，取值前必须守卫非空。
- 选区模式下多指分支 `stopPropagation()` 但**绝不 `preventDefault`**（保留原生双指缩放）。
- 不靠改 `touch-action`/`user-select` 走浏览器原生选区；不合成鼠标事件（xterm 忽略 untrusted 事件）。
- 复制链路（`term.getSelection()` / `Ctrl+C` 处理器）不变，因为 `term.select()` 产生的是真 xterm 选区。

---

### Task 1: 新增单元格换算辅助函数

**Files:**
- Modify: `public/index.html`（在 `setupTouchScroll()` 之前，约 L1295 之后新增函数）

**Interfaces:**
- Produces: `getActiveTerm()` 返回当前活动会话的 xterm `term` 对象或 `null`；`cellOfTouch(t)` 接收 `Touch` 对象返回 `{col, row}`（已 clamp 到合法范围）。
- Consumes: 全局 `activeId`、`sessions`（Map<number, session>），session 上有 `.term` 属性。

- [ ] **Step 1: 在 `setupTouchScroll()` 上方新增两个辅助函数**

在 `public/index.html` 的 `function setupTouchScroll() {`（约 L1296）**之前**插入：

```javascript
        // === 选区模式移动端触摸选区辅助（2026-07-21）===
        let selStartCell = { col: 0, row: 0 };  // 选区模式：单指拖选的起点单元格
        // 取当前活动会话的 xterm 实例；无活动会话时返回 null。
        function getActiveTerm() {
            const s = (typeof activeId !== 'undefined' && activeId != null) ? sessions.get(activeId) : null;
            return s ? s.term : null;
        }
        // 把一次触摸点换算成单元格坐标（带视口滚动偏移 + clamp）。
        // cell 尺寸取内部 API，取值前守卫非空；任一依赖缺失则回退到 {col:0,row:0}。
        function cellOfTouch(t) {
            const term = getActiveTerm();
            if (!term || !term._core || !term._core._renderService ||
                !term._core._renderService.dimensions || !term._core._renderService.dimensions.css ||
                !term._core._renderService.dimensions.css.cell || !term.element) {
                return { col: 0, row: 0 };
            }
            const cell = term._core._renderService.dimensions.css.cell;
            const rect = term.element.getBoundingClientRect();
            const col = Math.floor((t.clientX - rect.left) / cell.width);
            const rowVisible = Math.floor((t.clientY - rect.top) / cell.height);
            const row = term.buffer.active.viewportY + rowVisible;
            return {
                col: Math.max(0, Math.min(term.cols - 1, col)),
                row: Math.max(0, Math.min(term.buffer.active.length - 1, row))
            };
        }
```

- [ ] **Step 2: 人工核对（无自动化测试框架）**

运行：`grep -n "function getActiveTerm\|function cellOfTouch" public/index.html`
Expected: 两行均出现，证明函数已定义且语法未被破坏（本仓库无单元测试框架，靠浏览器实测 + 真机验收）。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat(选区模式): 新增单元格换算辅助 getActiveTerm/cellOfTouch"
```

---

### Task 2: 改 `onTouchScrollStart` 选区模式分支

**Files:**
- Modify: `public/index.html:1303-1327`（`onTouchScrollStart` 整个函数体）

**Interfaces:**
- Consumes: `getActiveTerm()`、`cellOfTouch(t)`（Task 1）；全局 `selectionMode`、`pinchActive`、`swipeTouchId`、`swipeActive`、`swipeStartX/Y/LastY/Accum`、`swipeClassify`、`swipeThreshold`。
- Produces: 选区模式单指时调用 `term.select(col,row,0)` 建立起点；多指时置 `pinchActive` 并 `stopPropagation()`。

- [ ] **Step 1: 用以下实现替换 `onTouchScrollStart` 整个函数**

把 `public/index.html` 第 1303–1327 行（从 `function onTouchScrollStart(e) {` 到该函数的结束 `}`）替换为：

```javascript
        function onTouchScrollStart(e) {
            if (selectionMode) {
                // 选区模式：用触摸驱动 xterm 选区，并拦掉 xterm 手势处理器（杜绝 NaN 垃圾）。
                if (e.touches.length >= 2) {
                    // 多指：走双指缩放拦截，但绝不 preventDefault（保留原生缩放），不干扰选区。
                    pinchActive = true; swipeTouchId = null; swipeActive = false;
                    e.stopPropagation();
                    return;
                }
                if (e.touches.length === 1) {
                    const term = getActiveTerm();
                    if (term) {
                        const c = cellOfTouch(e.touches[0]);
                        selStartCell = c;                    // 记录拖选起点（move 中用于规范化）
                        term.select(c.col, c.row, 0);   // 折叠光标到起点；后续 move 实时扩展
                    }
                    e.stopPropagation();                // 捕获阶段截住 xterm 冒泡监听，避免 NaN
                }
                return;
            }
            if (!e.target || !e.target.closest || !e.target.closest('#terminal-container'))
                return;                                 // 终端区域外（底部栏等）放行
            // 自愈：若上一次捏合的最终抬手事件被浏览器丢失而导致 pinchActive 卡在 true，
            // 后续任何单指触摸都说明"已无捏合在进行"，强制解除，避免单指滚动被误判为 pinch 而失效。
            // 仅 touches<2 时解除；真正的双指捏合由下方 e.touches.length>=2 重新置位，无回归。
            if (pinchActive && e.touches.length < 2) pinchActive = false;
            if (e.touches.length >= 2) {
                // 双指捏合缩放：挡掉 xterm 手势处理（否则它把双指当滚动、松手惯量发 NaN 垃圾且吃掉缩放），
                // 但绝不 preventDefault，浏览器按 CSS touch-action: pan-x pinch-zoom 执行原生缩放。
                pinchActive = true; swipeTouchId = null; swipeActive = false;
                e.stopPropagation();
                return;
            }
            if (e.touches.length !== 1) { swipeTouchId = null; swipeActive = false; return; }
            // 单指：直接挡掉 xterm 的手势处理（否则它会在 touchstart 记录触摸、touchend 触发
            // 惯量滚动并发 NaN 坐标的 SGR 垃圾 ESC[<65;NaN;NaNM，还会与我们的 smartScroll 双重滚动）。
            // 单指滚动我们自己接管；此处不 preventDefault，让轻点聚焦照常。
            e.stopPropagation();
            const t = e.touches[0];
            swipeTouchId = t.identifier;
            swipeStartX = t.clientX; swipeStartY = t.clientY;
            swipeLastY = t.clientY; swipeAccum = 0; swipeActive = false;
        }
```

- [ ] **Step 2: 人工核对**

运行：`grep -n "选区模式：用触摸驱动 xterm 选区" public/index.html`
Expected: 命中 1 行，证明分支已写入。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat(选区模式): 单指触摸起点驱动 term.select 并截流 xterm 手势"
```

---

### Task 3: 改 `onTouchScrollMove` 选区模式分支

**Files:**
- Modify: `public/index.html:1329-1352`（`onTouchScrollMove` 整个函数体）

**Interfaces:**
- Consumes: `cellOfTouch(t)`、`getActiveTerm()`（Task 1）；全局 `selectionMode`、`pinchActive`、`swipeTouchId`、`swipeActive`、`swipeStartX/Y`、`swipeClassify`、`swipeThreshold`、`smartScroll`。
- Produces: 选区模式单指移动时实时调用 `term.select(c1,r1,len)` 扩展选区。

- [ ] **Step 1: 用以下实现替换 `onTouchScrollMove` 整个函数**

把 `public/index.html` 第 1329–1352 行替换为：

```javascript
        function onTouchScrollMove(e) {
            if (selectionMode) {
                // 选区模式：单指移动实时扩展 xterm 选区；多指缩放只拦 xterm 不拦浏览器。
                if (pinchActive) { e.stopPropagation(); return; }
                if (e.touches.length === 1) {
                    const term = getActiveTerm();
                    if (term) {
                        const t = e.touches[0];
                        const c = cellOfTouch(t);
                        // 规范化：保证 (c1,r1) 在左上、(c2,r2) 在右下
                        const c1 = Math.min(selStartCell.col, c.col);
                        const r1 = Math.min(selStartCell.row, c.row);
                        const c2 = Math.max(selStartCell.col, c.col);
                        const r2 = Math.max(selStartCell.row, c.row);
                        const len = (r2 - r1) * term.cols + (c2 - c1) + 1;
                        term.select(c1, r1, len);
                    }
                    e.stopPropagation();
                }
                return;
            }
            if (pinchActive) { e.stopPropagation(); return; }  // 双指缩放中：只挡 xterm，不拦浏览器默认缩放
            if (swipeTouchId === null) return;
            let t = null;
            for (const c of e.changedTouches) if (c.identifier === swipeTouchId) { t = c; break; }
            if (!t) return;
            if (!swipeActive) {
                const dy = t.clientY - swipeStartY;
                const dx = t.clientX - swipeStartX;
                if (Math.abs(dy) > swipeClassify && Math.abs(dy) > Math.abs(dx)) {
                    swipeActive = true; swipeAccum = 0; swipeLastY = t.clientY;  // 竖向占优→判定为滚动
                } else {
                    return;  // 未达阈值 / 横滑 / 轻点：放行（已无 xterm 竞争，不会发垃圾）
                }
            }
            e.preventDefault();
            e.stopPropagation();   // 捕获阶段 stopPropagation 截住 xterm 的冒泡阶段监听
            const dyStep = t.clientY - swipeLastY;
            swipeAccum += dyStep;
            swipeLastY = t.clientY;
            // 移动端自然手感：手指上滑(accum 负)→内容向上→看更新/更下方；手指下滑(accum 正)→看更早
            while (swipeAccum >= swipeThreshold)  { smartScroll(-1); swipeAccum -= swipeThreshold; }  // 手指下滑 → 看更早
            while (swipeAccum <= -swipeThreshold) { smartScroll(1);  swipeAccum += swipeThreshold; }  // 手指上滑 → 看更新
        }
```

- [ ] **Step 2: 人工核对**

运行：`grep -n "selStartCell" public/index.html`
Expected: 命中（函数内引用），但注意 `selStartCell` 在 Task 4 才声明——本步仅确认引用写入；编译期不会报错（函数未调用时变量查找延后），真机/浏览器实测在 Task 4 之后进行。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat(选区模式): 单指移动实时扩展 term.select 选区"
```

---

### Task 4: 改 `onTouchScrollEnd` 选区模式分支

**Files:**
- Modify: `public/index.html:1354-1368`（`onTouchScrollEnd` 整个函数体）

**Interfaces:**
- Consumes: 全局 `selectionMode`、`pinchActive`、`swipeTouchId`、`swipeActive`、`selStartCell`（Task 1 声明、Task 2 设置）。
- Produces: `onTouchScrollEnd` 选区模式下清起点状态、不清理选区（保留供复制）。

- [ ] **Step 1: 用以下实现替换 `onTouchScrollEnd` 整个函数**

把 `public/index.html` 第 1354–1368 行替换为：

```javascript
        function onTouchScrollEnd(e) {
            if (selectionMode) {
                // 选区模式：清起点，但保留选区（供复制按钮 / Ctrl+C 使用）。
                if (pinchActive) {
                    e && e.stopPropagation();
                    if (e && e.touches.length > 0) {
                        swipeTouchId = null; swipeActive = false;  // 还有手指在屏：保持 pinchActive
                        return;
                    }
                    pinchActive = false;
                }
                if (swipeTouchId !== null || swipeActive) e && e.stopPropagation();
                selStartCell = { col: 0, row: 0 };
                swipeTouchId = null; swipeActive = false;
                return;
            }
            if (pinchActive) {
                // 双指缩放：直到全部手指抬起才解除，避免残留单指误触发滑动；
                // 挡掉 xterm 的 touchend（其惯量逻辑会发 NaN 垃圾），不 preventDefault。
                e && e.stopPropagation();
                if (e && e.touches.length > 0) {
                    swipeTouchId = null; swipeActive = false;  // 还有手指在屏：保持 pinchActive
                    return;
                }
                pinchActive = false;
            }
            // 挡掉 xterm 的 touchend：否则它会对单指滑动做惯量滚动并发 NaN 坐标的 SGR 垃圾
            if (swipeTouchId !== null || swipeActive) e && e.stopPropagation();
            swipeTouchId = null; swipeActive = false;
        }
```

- [ ] **Step 2: 人工核对**

运行：`grep -n "selStartCell = { col: 0, row: 0 }" public/index.html`
Expected: 命中两处（Task 1 声明处 + 本函数复位处），证明起点状态闭环。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat(选区模式): 清理 touchEnd 分支并复位拖选起点"
```

---

### Task 5: 浏览器实测验证（量化对比）

**Files:**
- Test: 临时 Playwright 脚本（验证后删除，不进仓库）

**Interfaces:**
- Consumes: 已实现的 `public/index.html`；xterm 实例暴露 `term.select`/`hasSelection`/`getSelection`/`onData`。
- Produces: 量化证据——选区模式单指拖 `hasSelection===true`、全程 `ESC[<` 垃圾 `===0`、非选区模式单指拖 `hasSelection===false` 且滑动次数与改动前一致。

- [ ] **Step 1: 起本地静态服务并写 Playwright 触摸仿真脚本**

脚本要点（新建 `repro_touch_integ.html` + `repro_touch_integ.js`，用 `http` 静态服务 `node_modules` 与页面）：
- HTML 加载 `node_modules/@xterm/xterm/lib/xterm.js` 与 css，创建 `new Terminal()`（DOM 渲染器默认），`term.write` 多行文本。
- 把 Tasks 1–4 实现的 `getActiveTerm`/`cellOfTouch`/`selStartCell`/`onTouchScrollStart/Move/End` **原样**粘贴进页面 `<script>`，并 `document.addEventListener('touchstart/move/end/cancel', handler, {capture:true})`。
- 暴露 `window.setMode(v)`（设 `selectionMode`）、`window.getInfo()` 返回 `{hasSelection, selection, garbageCount}`（用 `term.onData` 收集含 `ESC[<` 即 `\x1b[<` 的串计数）、`window.clearAll()`。
- `repro_touch_integ.js` 用 `chromium.launch({args:['--touch-events=enabled']})` + CDP `Emulation.setTouchEmulationEnabled({enabled:true,maxTouchPoints:2})`，对 `.xterm-rows` 区域派发单指 `touchStart→10步touchMove→touchEnd`（向下 / 向上反向）与双指 pinch。

- [ ] **Step 2: 跑量化对比，确认四组达标**

运行：`node repro_touch_integ.js`
断言全部成立：
1. 选区模式 + 单指拖（向下 / 向上反向）：`hasSelection === true` 且 `selection` 文本正确。
2. 选区模式全程：`garbageCount === 0`（无 `ESC[<65;NaN;NaNM` 垃圾）。
3. 非选区模式 + 单指拖：`hasSelection === false` 且 `smartScroll` 触发次数与改动前一致（设计文档实证基线为 7 次/200px）。
4. 双指（选区 / 非选区）：`hasSelection === false`、无垃圾、不崩溃。

Expected: 全部通过。

- [ ] **Step 3: 真机验收（用户侧）**

提示用户在安卓真机：开「选区模式」→ 手指拖选终端文字 → 应出现高亮选区 → 用复制按钮 / Ctrl+C 复制成功；过程中终端不出现 `ESC[<65;NaN;NaNM` 乱码。

- [ ] **Step 4: 删除临时脚本，不进仓库**

```bash
rm -f repro_touch_integ.html repro_touch_integ.js
```
