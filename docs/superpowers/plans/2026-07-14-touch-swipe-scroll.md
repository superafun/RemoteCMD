# 触摸滑动模拟鼠标滚轮滚动（MVP）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在终端区域上下滑动手指即可模拟鼠标滚轮，TUI 和普通命令行都能正常滚动，省去在安卓上点按钮。

**Architecture:** 纯前端改动。新增一个 `smartScroll(dir)` 函数，逻辑与真实鼠标滚轮一致（TUI 鼠标追踪开→发 SGR 给 PTY，否则→滚 xterm 视口）；再在 `document` 捕获阶段挂触摸监听，竖向占优的手势按像素阈值调用 `smartScroll`。选区模式开启时手势整体禁用，避免与 xterm 原生拖选冲突。

**Tech Stack:** 原生 JS（public/index.html 内联）、xterm.js v6（已依赖）、CSS（public/styles.css）。无打包工具、无框架。

## Global Constraints

- **纯前端**：只改 `public/index.html` 与 `public/styles.css`，**不**动 `server.js` / WebSocket 协议 / `config.json`。刷新网页即生效，无需重启服务器（改前端前先 `Get-NetTCPConnection -LocalPort 65433` 确认后端在跑，连现成服务测即可）。
- **每次代码改动必须立即 `git commit`**，禁止 `git add -A`；一个独立变更一个 commit。
- **无测试框架**：本仓库无测试/linter（AGENTS.md 已注明）。触摸手势只能安卓真机验证；桌面用浏览器 DevTools 控制台手动验证函数行为。
- **`wsSend` 唯一出口**：所有 `ws.send()` 必须走 `wsSend`（本改动不新增 WebSocket 发送，仅复用 `sendSgrWheel` 内的 `wsSend`，无需改动）。
- **选区模式标志**：`selectionMode` 是 `index.html` 全局布尔（index.html:371，已镜像到 `window.selectionMode`），手势直接引用，不要新建标志。
- **性能**：每次累积 `SWIPE_THRESHOLD`(24px) 才调一次 `smartScroll`，零 DOM 操作（详见设计文档性能分析）。

---

### Task 1: 新增 `smartScroll(dir)` 函数

**Files:**
- Modify: `public/index.html`（在现有 `scrollUp/scrollDown/scrollXtermUp/scrollXtermDown` 函数附近，约 865-869 行，新增 `smartScroll`）

**Interfaces:**
- Consumes: `sessions.get(activeId)`（Map<id, TermSession>）、`TermSession.sendSgrWheel(dir)`（term-session.js:159）、`TermSession.scrollLines(n)`（term-session.js:133）、`term.modes.mouseTrackingMode`（xterm 实例字段，'none'|'x10'|'vt200'|'drag'|'any'）
- Produces: `smartScroll(dir)` —— 后续 Task 2 的 `setupTouchScroll` 调用；`dir` 为 `-1`(上滑/看更早) 或 `+1`(下滑)，无返回值

- [ ] **Step 1: 在 `public/index.html` 现有滚动函数旁新增 `smartScroll`**

在 `scrollUp`/`scrollDown` 定义之后插入（保持与现有按钮函数同处，便于阅读）：

```js
        // 统一滚动：与真实鼠标滚轮同逻辑（TUI 鼠标追踪开→发 SGR 给 PTY；否则→滚 xterm 视口）
        function smartScroll(dir) {            // dir: -1 上滑（看更早内容）, +1 下滑
            const s = sessions.get(activeId);
            if (!s) return;
            if (s.term.modes.mouseTrackingMode !== 'none')
                s.sendSgrWheel(dir);          // TUI 自己滚
            else
                s.scrollLines(dir);           // 普通 CLI：xterm 滚视口看历史
        }
```

- [ ] **Step 2: 桌面浏览器手动验证（DevTools 控制台）**

说明：本步只验证 `smartScroll` 逻辑正确，尚未接手势。打开网页（连现成 65433 服务），F12 控制台：
1. 普通 PowerShell 提示符下先输出大量内容（如 `Get-ChildItem C:\ -Recurse | Select-Object -First 500`），在控制台执行 `smartScroll(-1)` 几次 → 视口历史应向上滚动；`smartScroll(1)` → 向下。
2. 打开 TUI（如 `vim`、`less` 某个长文件、`htop`），在控制台执行 `smartScroll(-1)`/`smartScroll(1)` → TUI 内容应跟随滚动（vim 翻页 / less 上下）。
3. 预期：两类场景都正确响应，无 JS 报错。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: 新增 smartScroll 统一滚动函数（逻辑=真实鼠标滚轮）"
```

---

### Task 2: 触摸滑动监听 `setupTouchScroll()` + CSS + 初始化

**Files:**
- Modify: `public/index.html`（新增 `setupTouchScroll` 及 4 个 touch 处理函数；在现有 `DOMContentLoaded` 回调内追加调用）
- Modify: `public/styles.css`（终端元素加 `touch-action: pan-x`）

**Interfaces:**
- Consumes: `smartScroll(dir)`（Task 1 产出）、`selectionMode`（全局布尔，index.html:371）、`document` 事件
- Produces: 无新导出；手势行为在页面加载后生效

- [ ] **Step 1: 在 `public/index.html` 新增触摸滑动逻辑**

在 `smartScroll` 函数之后插入：

```js
        // === 触摸滑动模拟鼠标滚轮（纯前端，详见设计文档）===
        const SWIPE_THRESHOLD = 24;   // 每累计多少 px 触发一次滚动，真机调
        const SWIPE_CLASSIFY  = 10;   // 超过此位移且纵向占优才判定为滚动
        let swipeTouchId = null;      // 当前处理的触点 identifier，null=无
        let swipeActive  = false;     // 本次手势是否已判定为滚动
        let swipeStartX = 0, swipeStartY = 0, swipeLastY = 0, swipeAccum = 0;

        function setupTouchScroll() {
            document.addEventListener('touchstart',  onTouchScrollStart, { capture: true });
            document.addEventListener('touchmove',   onTouchScrollMove,  { capture: true });
            document.addEventListener('touchend',    onTouchScrollEnd,   { capture: true });
            document.addEventListener('touchcancel', onTouchScrollEnd,   { capture: true });
        }

        function onTouchScrollStart(e) {
            if (selectionMode) { swipeTouchId = null; swipeActive = false; return; }  // 选区模式交给 xterm 原生拖选
            if (e.touches.length !== 1) { swipeTouchId = null; swipeActive = false; return; }  // 仅单指
            const t = e.touches[0];
            if (!t.target || !t.target.closest || !t.target.closest('#terminal-container')) {
                swipeTouchId = null; swipeActive = false; return;   // 终端区域外（底部栏等）放行
            }
            swipeTouchId = t.identifier;
            swipeStartX = t.clientX; swipeStartY = t.clientY;
            swipeLastY = t.clientY; swipeAccum = 0; swipeActive = false;
            // 注意：此处不 preventDefault，让轻点聚焦 / 长按选区照常
        }

        function onTouchScrollMove(e) {
            if (swipeTouchId === null) return;
            let t = null;
            for (const c of e.changedTouches) if (c.identifier === swipeTouchId) { t = c; break; }
            if (!t) return;
            if (!swipeActive) {
                const dy = t.clientY - swipeStartY;
                const dx = t.clientX - swipeStartX;
                if (Math.abs(dy) > SWIPE_CLASSIFY && Math.abs(dy) > Math.abs(dx)) {
                    swipeActive = true; swipeAccum = 0; swipeLastY = t.clientY;  // 竖向占优→判定为滚动
                } else {
                    return;  // 未达阈值 / 横滑 / 轻点：放行给 xterm
                }
            }
            e.preventDefault();
            e.stopPropagation();   // 捕获阶段 stopPropagation 可截住 xterm 的冒泡阶段选区监听
            const dyStep = t.clientY - swipeLastY;
            swipeAccum += dyStep;
            swipeLastY = t.clientY;
            while (swipeAccum >= SWIPE_THRESHOLD)  { smartScroll(1);  swipeAccum -= SWIPE_THRESHOLD; }  // 下滑
            while (swipeAccum <= -SWIPE_THRESHOLD) { smartScroll(-1); swipeAccum += SWIPE_THRESHOLD; }  // 上滑
        }

        function onTouchScrollEnd() {
            swipeTouchId = null; swipeActive = false;
        }
```

- [ ] **Step 2: 在 `DOMContentLoaded` 回调内追加初始化调用**

找到现有 `DOMContentLoaded` 回调（其中调用 `syncLayoutWidths()` 的那处，index.html 约 383 行附近），在 `syncLayoutWidths()` 调用之后追加一行：

```js
            setupTouchScroll();
```

- [ ] **Step 3: 在 `public/styles.css` 给终端元素加 `touch-action`**

在样式文件适当位置（`.terminal-wrapper` 或 `.xterm` 相关规则附近）新增/修改，确保纵向手势交给 JS、横向仍由浏览器处理（如返回手势）：

```css
        .terminal-wrapper { touch-action: pan-x; }
        .xterm { touch-action: pan-x; }
```

> 实现时确认 xterm 是否在其自身元素上设了 `touch-action`；若 `.xterm` 被覆盖，以 `.xterm` 这一条为准（它更具体）。两者都写可保底。

- [ ] **Step 4: 桌面浏览器验证无报错 + 逻辑自检**

1. 刷新网页（连现成 65433），打开 DevTools Console：确认加载时无 JS 报错，`setupTouchScroll` 已绑定（可用 `getEventListeners(document)` 确认有 4 个 touch 监听，capture 阶段）。
2. 桌面无触摸设备，无法真滑；用控制台验证守卫逻辑：
   - `selectionMode = true` 状态下（点"选区模式"按钮），手势应整体禁用——可在控制台手动 `onTouchScrollStart({touches:[{identifier:1,target:document.querySelector('.xterm'),clientX:0,clientY:0}], preventDefault(){}, stopPropagation(){}})` 后查 `swipeTouchId` 仍为 `null`。
   - `selectionMode = false` 时同样构造 touchstart，再构造一个 `touchmove`（dy 超阈值、纵向占优）应触发 `smartScroll` 调用（可在 `smartScroll` 内临时 `console.log('smartScroll', dir)` 确认）。验证后移除临时 log。
3. 预期：桌面加载正常、无报错；守卫与判定逻辑符合预期。

- [ ] **Step 5: 提交**

```bash
git add public/index.html public/styles.css
git commit -m "feat: 终端区上下滑动模拟鼠标滚轮（捕获阶段 touch 监听 + touch-action）"
```

---

### Task 3: 安卓真机验收（手感与冲突）

**Files:**
- 无代码改动（仅验收与按反馈微调阈值）

**Interfaces:**
- Consumes: 已部署的前端（`smartScroll` + `setupTouchScroll`）
- Produces: 真机反馈（阈值 `SWIPE_THRESHOLD`/`SWIPE_CLASSIFY` 是否需要调整）；若手感 OK，后续再议"4 按钮合并为 2"

- [ ] **Step 1: 真机基础滚动验证**
  安卓浏览器打开网页（连现成 65433 服务），逐项验证：
  1. **TUI**：打开 `vim`/`less`/`htop` 等开鼠标追踪的程序，在终端区上下滑动 → TUI 内容跟随滚动。
  2. **普通 CLI**：PowerShell 提示符下输出大量内容，上下滑动 → xterm 视口历史跟随滚动。
  3. 预期：两类场景滑动都能滚，方向与手指一致（上滑看更早、下滑看更新）。

- [ ] **Step 2: 冲突与不误伤验证**
  1. **选区模式**：开启"选区模式"后滑动 → 不触发滚动，长按拖选文字正常。
  2. **轻点/长按**：未达 `SWIPE_CLASSIFY`(10px) 的轻点应正常聚焦终端；长按应正常进入选区（不误判为滚动）。
  3. **横滑**：底部栏横滑切换按钮仍正常（不被终端手势拦截）；页面横向返回手势不被破坏。
  4. **多指**：双指不触发误滚。
  5. **其他 UI**：右键粘贴、Ctrl+V、发按键面板、输入条、4 个滚动按钮原有行为不受影响。

- [ ] **Step 3: 手感微调（如需）**
  根据真机反馈调整 `public/index.html` 顶部常量：
  - 太灵敏/太顿 → 调 `SWIPE_THRESHOLD`（默认 24，单位 px）。
  - 轻微移动就误判滚动 → 调大 `SWIPE_CLASSIFY`（默认 10）。
  调整后刷新网页复测，确认满意后提交（若改了阈值）：
  ```bash
  git add public/index.html
  git commit -m "tweak: 调整触摸滑动滚动阈值（真机手感）"
  ```

---

## 自审（Self-Review）

**1. Spec 覆盖：**
- `smartScroll(dir)` 内核 → Task 1 ✅
- `setupTouchScroll` 捕获阶段 touch 监听 + 守卫（单指 / 终端区域 / 选区模式） → Task 2 ✅
- 竖向占优判定 + 阈值触发 → Task 2 ✅
- CSS `touch-action: pan-x` → Task 2 ✅
- 初始化调用 → Task 2 Step 2 ✅
- 边界（轻点/横滑/多指/无会话/选区模式） → Task 2 代码 + Task 3 验收 ✅
- 性能分析 → 已在设计文档；代码零 DOM 操作，符合 ✅
- 真机验收 → Task 3 ✅
- 按钮不动、纯前端、不碰 server.js/协议/config.json → 全程遵守 ✅

**2. 占位符扫描：** 无 TBD/TODO/"类似 Task N"。所有 step 含具体代码或命令。

**3. 类型/签名一致性：**
- Task 2 调用 `smartScroll(dir)` 与 Task 1 定义签名一致（-1/+1）。
- `selectionMode` 引用与 index.html:371 全局布尔一致。
- `sessions`/`TermSession.sendSgrWheel`/`scrollLines`/`term.modes.mouseTrackingMode` 均为既有 API，签名未改。
- 无跨任务命名漂移。
