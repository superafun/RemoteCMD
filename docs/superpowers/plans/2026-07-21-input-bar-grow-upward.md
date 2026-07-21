# 输入条向上扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让展开的输入条在输入超过一行时向上扩展、盖住终端底部，且「发按键 / 换行」等按钮底边始终贴屏幕底可见。

**Architecture:** 纯 CSS 改动（不涉及 JS）。通过 `position: sticky; bottom:0` 把底部栏锁在视口底边，并把 `#hotkeys-bar` / `#inputBarWrap` 的对齐由 `flex-start` 改为 `flex-end`，使文本框底边与按钮底边平齐、文字增多时向上长。上限由 `max-height:160px` 提到 `50vh`。`:root` 加 `interactive-widget: resizes-content` 兜底安卓键盘不遮挡锁底栏。验证用 Playwright 直接打开真实运行的服务测量像素（非简化 HTML）。

**Tech Stack:** HTML/CSS（flexbox、`position: sticky`）、Playwright（仅作开发期验证，不进运行时依赖）。

## Global Constraints

- 仅改动 `public/styles.css`；`public/index.html` 与任何 JS（`autoGrow`、`toggleInputBar` 等）**不改动**。
- `#hotkeys-bar` 必须 `position: sticky; bottom: 0`，且因 `sticky` 保留在 `#page` 流盒内，宽度自动等于终端宽度，不得改用 `fixed`（会撑成全屏宽）。
- 文本框上限 `max-height: 50vh`（原为 `160px`），超过后内部滚动（`overflow:auto` 已具备）。
- 栏必须不透明背景，否则盖住终端时文字透出。
- 安卓不走 `visualViewport` JS，`interactive-widget: resizes-content` 兜底即可。
- 服务端口固定 `65433`，服务用 `node server.js` 启动（或 `npm start`/pm2）。
- Playwright 仅作验证工具，用 `npm i playwright --no-save` 临时装入 `node_modules`，**不得写入 `package.json`**。

---

### Task 1: 编写 Playwright 验证脚本（先于改动，应失败）

**Files:**
- Create: `tests/input-bar-upward-check.mjs`

**Interfaces:**
- 无（独立验证脚本）。
- Produces: 一个可重复运行的像素断言脚本，后续 CSS 改完后应 PASS。

- [ ] **Step 1: 写验证脚本**

`tests/input-bar-upward-check.mjs`：

```js
import { chromium } from 'playwright';

const URL = 'http://localhost:65433';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await page.goto(URL, { waitUntil: 'networkidle' });

// 展开输入条
await page.click('#inputBarBtn');
await page.waitForSelector('#inputBarWrap', { state: 'visible' });

// 灌入多行文本并触发 autoGrow（input 事件）
await page.evaluate(() => {
  const ta = document.getElementById('inputBarText');
  ta.value = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(150);

const m = await page.evaluate(() => {
  const vh = window.innerHeight;
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const cs = (id) => getComputedStyle(document.getElementById(id));
  return {
    vh,
    wrap: r('inputBarWrap'),
    ta: r('inputBarText'),
    send: r('inputBarSend'),
    term: r('terminal-container'),
    taMaxH: cs('inputBarText').maxHeight,
    wrapAlign: cs('inputBarWrap').alignItems,
    barPos: cs('hotkeys-bar').position,
    barBottom: cs('hotkeys-bar').bottom,
    barAlign: cs('hotkeys-bar').alignItems,
    barBg: cs('hotkeys-bar').backgroundColor,
  };
});

const errors = [];
if (Math.abs(m.wrap.bottom - m.vh) > 2) errors.push(`输入条底边 ${m.wrap.bottom.toFixed(1)} 不在视口底 ${m.vh}（吸底失败）`);
if (Math.abs(m.ta.bottom - m.send.bottom) > 2) errors.push(`文本框底边 ${m.ta.bottom.toFixed(1)} 与换行按钮底边 ${m.send.bottom.toFixed(1)} 不平齐（flex-end 失败）`);
// 文本框与终端存在重叠 = 确实向上盖住终端（比单纯比较 top/bottom 更稳健）
const overlap = !(m.ta.bottom <= m.term.top || m.ta.top >= m.term.bottom);
if (!overlap) errors.push(`文本框(${m.ta.top.toFixed(1)}~${m.ta.bottom.toFixed(1)}) 未与终端(${m.term.top.toFixed(1)}~${m.term.bottom.toFixed(1)}) 重叠（未向上扩展盖住终端）`);
if (m.barPos !== 'sticky') errors.push(`hotkeys-bar position=${m.barPos}，应为 sticky`);
if (m.barBottom !== '0px') errors.push(`hotkeys-bar bottom=${m.barBottom}，应为 0px`);
if (m.barAlign !== 'flex-end') errors.push(`hotkeys-bar align-items=${m.barAlign}，应为 flex-end`);
if (m.wrapAlign !== 'flex-end') errors.push(`inputBarWrap align-items=${m.wrapAlign}，应为 flex-end`);
if (!m.taMaxH.includes('vh')) errors.push(`文本框 max-height=${m.taMaxH}，应为 ~50vh`);
if (m.barBg === 'rgba(0, 0, 0, 0)' || m.barBg === 'transparent') errors.push(`hotkeys-bar 背景透明，会透出终端文字`);

await page.screenshot({ path: 'tests/input-bar-upward.png' });
await browser.close();

if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: 输入条向上扩展、吸底、按钮平齐');
```

- [ ] **Step 2: 临时安装 Playwright 并运行，确认当前代码 FAIL**

```bash
npm i playwright --no-save
npx playwright install chromium
node tests/input-bar-upward-check.mjs
```

Expected: 退出码非 0，打印 `FAIL:` 及若干条（如 `吸底失败`、`flex-end 失败`、`未向上扩展`、`max-height=160px` 等）。说明基线确实未满足预期。

- [ ] **Step 3: Commit 脚本**

```bash
git add tests/input-bar-upward-check.mjs
git commit -m "test: 输入条向上扩展的 Playwright 像素断言（基线应 FAIL）"
```

---

### Task 2: `#hotkeys-bar` 吸底 + 底部对齐 + 不透明背景；`:root` 加 interactive-widget

**Files:**
- Modify: `public/styles.css:2`（`html` 规则）
- Modify: `public/styles.css:254-261`（`#hotkeys-bar` 规则）

**Interfaces:**
- 无（纯样式，被 Task 3 与 Task 4 依赖其生效）。

- [ ] **Step 1: `html` 规则加 interactive-widget**

`public/styles.css` 第 2 行起：

```css
        html {
            overflow-x: auto;  /* 兜底：xterm 本身比视口宽时滚动 */
            interactive-widget: resizes-content;  /* 安卓键盘弹起时锁底栏停在键盘上方，不被遮挡 */
        }
```

- [ ] **Step 2: `#hotkeys-bar` 加吸底 / 改 flex-end / 加背景**

`public/styles.css` 第 254 行起：

```css
        #hotkeys-bar {
            display: flex;
            flex-wrap: nowrap;       /* 不换行，单行 */
            overflow-x: auto;        /* 超宽横向溢出可滚动 */
            gap: 0;
            align-items: flex-end;   /* 输入条变高时按钮贴底、文本框向上长 */
            position: sticky;        /* 锁在视口底边：输入条变高把页面撑超高时，底部栏不掉出屏幕 */
            bottom: 0;
            background: #1e1e1e;     /* 吸底后盖住终端，必须不透明，否则终端文字透出 */
            touch-action: pan-x;     /* 移动端授权横向 pan，禁掉竖向误滚 */
        }
```

（删除原 `align-items: flex-start;` 一行，替换为 `flex-end` 并新增 `position`/`bottom`/`background`。）

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "style: 底部栏 sticky 吸底 + flex-end + 不透明背景 + interactive-widget"
```

---

### Task 3: `#inputBarWrap` 改 flex-end；`#inputBarText` 上限提到 50vh

**Files:**
- Modify: `public/styles.css:275-281`（`#inputBarWrap` 规则）
- Modify: `public/styles.css:282-295`（`#inputBarText` 规则）

**Interfaces:**
- 无。

- [ ] **Step 1: `#inputBarWrap` align-items 改 flex-end**

`public/styles.css` 第 275 行起：

```css
        #inputBarWrap {
            display: flex;
            flex: 1 1 0;           /* 填满整行：发按键(最左)与换行(最右)之间全部是输入条 */
            min-width: 0;
            gap: 0;                /* 输入框右边缘紧贴换行按钮，不留空隙 */
            align-items: flex-end; /* 文本框底边与换行按钮底边平齐，文本框向上长 */
        }
```

（原 `align-items: flex-start;` → `flex-end`。）

- [ ] **Step 2: `#inputBarText` max-height 改 50vh**

`public/styles.css` 第 282 行起，仅改 `max-height` 一行（`160px` → `50vh`），其余保持不变：

```css
            max-height: 50vh;      /* 原为 160px：超半屏后内部滚动，盖住终端底部一部分 */
```

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "style: 输入条容器 flex-end + 文本框上限提至 50vh"
```

---

### Task 4: 运行验证并确认 PASS（必要时微调）

**Files:**
- Modify: `public/styles.css`（若背景色/上限需微调）
- Modify: `tests/input-bar-upward.png`（截图，可选重新生成）

**Interfaces:**
- 依赖 Task 1 的 `tests/input-bar-upward-check.mjs` 与 Task 2/3 的 CSS。

- [ ] **Step 1: 确保服务在 65433 运行**

```bash
node server.js
```

（另开一个终端保持运行；或 `npm start` 经 pm2。确认 http://localhost:65433 可访问。）

- [ ] **Step 2: 运行验证脚本**

```bash
node tests/input-bar-upward-check.mjs
```

Expected: 退出码 0，打印 `PASS: 输入条向上扩展、吸底、按钮平齐`。

若仍有 FAIL：
- `吸底失败` / `sticky` 不对 → 检查 Task 2 的 `position/bottom` 是否生效（确认服务读的是最新 `styles.css`，必要时硬刷新）。
- `背景透明` → 改 `#hotkeys-bar` 的 `background` 为终端实际背景色（如终端用了非默认主题则读取对齐）。
- `max-height` 不对 → 确认 `50vh` 已写入且未被其它规则覆盖。
- 微调后重新运行直至 PASS。

- [ ] **Step 3: 桌面浏览器人工抽查**

打开 http://localhost:65433，展开输入条逐行输入至超过半屏：确认文本框向上长盖住终端、「发按键 / 换行」贴屏幕底；关掉输入条后快捷键正常、无终端文字透出；点「大」切换终端尺寸后吸底仍正确。

- [ ] **Step 4: 安卓真机（HTTPS）抽查**

真机打开页面，展开输入条 + 软键盘弹起，确认输入条在键盘上方、可正常输入与发送（按「先桌面、真机再调」；若异常再迭代，不预加 visualViewport 逻辑）。

- [ ] **Step 5: 提交微调（若有）**

```bash
git add public/styles.css tests/input-bar-upward.png
git commit -m "style: 输入条向上扩展验证微调"
```

---

## 自审要点（实现者参考）

- 仅 `public/styles.css` 被改；`index.html`、`autoGrow`、其它 JS 一律不动。
- 未引入 `fixed`（保持宽度 = 终端宽度）。
- 未写 `visualViewport` JS。
- Playwright 未写入 `package.json`。
