# 底部快捷键栏单行化 + 横向溢出滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把底部快捷键栏从「多行换行」改为「单行不换行 + 超宽横向溢出滚动」，所有底部按钮一起随滑动移出/拉回屏幕。

**Architecture:** 纯前端 CSS 改动，零 JS / 零协议变更。把 `#hotkeys-bar` 容器改为 `flex-wrap: nowrap; overflow-x: auto`，并把 `#hotkeysList` 从「撑满」改为「按内容宽度排列」，底部栏按钮统一 `flex-shrink: 0; white-space: nowrap`，移动端加 `touch-action: pan-x` 兜底横滑。

**Tech Stack:** HTML + CSS（无构建步骤、无测试框架，按项目约定用手动/真机验收替代单测）。

## Global Constraints

- 不改 `server.js`、不新增 WebSocket 消息、不新增 JS 事件监听器、不新增 DOM 节点。
- 零协议变更；只改 CSS 规则 + 1 行内联 `flex-wrap`。
- `.toolbar`（顶栏）保持 `flex-wrap: wrap`，仅 `#hotkeys-bar` 改为单行。
- 移动端（Android 真机）手指横滑必须能滚动，且从按钮上起滑也要生效（`touch-action: pan-x` 兜底）。
- 每次代码改动完成后立即 `git commit`，单步回退用 `git revert HEAD`，禁止 `git reset --hard`、禁止 `git add -A`。
- 只改前端时不要重启服务器：先 `Get-NetTCPConnection -LocalPort 65433` 确认后端在跑，直接刷新网页即可验证。

---

### Task 1: 容器 `#hotkeys-bar` 单行化 + 溢出滚动

**Files:**
- Modify: `public/styles.css:218-224`（` .toolbar, #hotkeys-bar` 合并规则）

**Interfaces:**
- Consumes: 无
- Produces: `#hotkeys-bar` 变为单行横向滚动容器（供 Task 2/3 的按钮落位）

- [ ] **Step 1: 拆分 `.toolbar, #hotkeys-bar` 合并规则**

把现有规则（约 `styles.css:218-224`）：
```css
.toolbar, #hotkeys-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    align-items: center;
    /* width 由 #page flex 列布局默认 stretch 提供 */
}
```
改为两条独立规则：
```css
.toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    align-items: center;
    /* width 由 #page flex 列布局默认 stretch 提供 */
}
#hotkeys-bar {
    display: flex;
    flex-wrap: nowrap;       /* 不换行，单行 */
    overflow-x: auto;        /* 超宽横向溢出可滚动 */
    gap: 0;
    align-items: center;
    touch-action: pan-x;     /* 移动端授权横向 pan，禁掉竖向误滚 */
}
```

- [ ] **Step 2: 在浏览器验证容器行为**

运行：`Get-NetTCPConnection -LocalPort 65433` 确认后端在跑（不在则 `npm start`）。
打开 http://localhost:65433 ，用较多快捷键（或临时把窗口拉窄）让按钮超宽：
Expected：底部栏所有按钮处于同一行、右侧溢出屏幕外，桌面端出现横向滚动条，Shift+滚轮可左右滚动。

- [ ] **Step 3: Commit**
```bash
git add public/styles.css
git commit -m "feat: 底部栏容器改为单行横向溢出滚动"
```

### Task 2: `#hotkeysList` 按内容宽度排列

**Files:**
- Modify: `public/styles.css:232-235`（`#hotkeysList` 规则）
- Modify: `public/index.html:58`（内联 `flex-wrap`）

**Interfaces:**
- Consumes: Task 1 的 `#hotkeys-bar { overflow-x:auto; nowrap }`
- Produces: `#hotkeysList` 内部按钮不折行、整体按真实宽度排列并随父容器溢出

- [ ] **Step 1: 改 styles.css 中 `#hotkeysList` 的 flex 取值**

把（约 `styles.css:232-235`）：
```css
#hotkeysList {
    flex: 1 1 0;
    min-width: 0;
}
```
改为：
```css
#hotkeysList {
    flex: 0 0 auto;   /* 按内容真实宽度排列，不撑满、不挤压，超宽才溢出 */
}
```

- [ ] **Step 2: 改 index.html 中 `#hotkeysList` 内联样式**

把 `public/index.html:58`：
```html
<div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;">
```
改为：
```html
<div id="hotkeysList" style="display:flex;gap:0;flex-wrap:nowrap;">
```

- [ ] **Step 3: 验证内部不折行**

刷新网页，确认 `#hotkeysList` 内的快捷键按钮、`编辑` 按钮、滚动按钮组均在同一行内、不各自换行，且整体随父容器 `#hotkeys-bar` 一起横向溢出。

- [ ] **Step 4: Commit**
```bash
git add public/styles.css public/index.html
git commit -m "feat: 快捷键列表按内容宽度排列且不换行"
```

### Task 3: 底部栏按钮不压缩 + 文字不折行

**Files:**
- Modify: `public/styles.css:287-295`（`.toolbar button, #hotkeys-bar button` 及 `#scrollGroup button` 区域）

**Interfaces:**
- Consumes: Task 1/2 的容器与列表布局
- Produces: 底部栏所有按钮 `flex-shrink:0` + `white-space:nowrap`，保证横滑时不被压缩、文字不折行

- [ ] **Step 1: 追加 `#hotkeys-bar button` 不压缩规则**

在现有（约 `styles.css:287-289`）：
```css
.toolbar button, #hotkeys-bar button {
    min-width: 60px;  /* 防止短文字按钮（如 ▲、编辑）被压缩到看不清 */
}
```
之后追加一条：
```css
/* 底部栏按钮：单行横滑时不被压缩、文字不折行 */
#hotkeys-bar button {
    flex-shrink: 0;
    white-space: nowrap;
}
```

- [ ] **Step 2: 确认 `#scrollGroup button` 不受影响**

检查 `styles.css` 中 `#scrollGroup button`（约 291-295）：
```css
#scrollGroup button {
    padding-left: 6px;
    padding-right: 6px;
    min-width: 0;  /* 取消通用 min-width: 60px,允许按内容收缩 */
}
```
保持不动。Task 3 Step 1 的 `#hotkeys-bar button { flex-shrink:0 }` 会让滚动按钮也不被压缩——它们本就按内容宽度显示，符合预期；`min-width:0` 仍允许其按内容收缩到小于 60px，与现状一致。

- [ ] **Step 3: 验证横滑按钮完整可见**

刷新网页，横滑到底部栏最右端：确认 `编辑` 按钮与 5 个滚动按钮（▲ ▼ ▲ ▼ ▽）全部以真实宽度显示、文字不折行、不重叠。

- [ ] **Step 4: Commit**
```bash
git add public/styles.css
git commit -m "feat: 底部栏按钮横滑时不压缩不折行"
```

### Task 4: 移动端真机验收 + 输入条模式回归

**Files:**
- 无文件改动，纯验收

**Interfaces:**
- Consumes: Task 1-3 全部 CSS 改动

- [ ] **Step 1: Android 真机横滑验收**

在 Android 真机打开网页，底部栏按钮较多时：
- 手指从按钮间隙起滑：向左横滑能把最右侧「编辑 / 滚动按钮」拉回屏幕内，松手停住不回弹。
- 手指从按钮上起滑：同样能横滑（验证 `touch-action: pan-x` 兜底生效，未被全局 `pointerdown` 的 `preventDefault` 拦截）。

- [ ] **Step 2: 输入条模式回归**

点「输入条」展开：确认输入条独占整行、无溢出滚动条；发送（或 Esc 收起）后恢复单行按钮栏，横滑仍正常。

- [ ] **Step 3: 快捷键少时回归**

快捷键较少时：底部栏单行、无横向滚动条，`编辑`+滚动按钮组靠右对齐（`#scrollGroup { margin-left:auto }` 生效）。

- [ ] **Step 4: 验收通过则补充 AGENTS 注意事项，否则回退对应 Task**

若验收有瑕疵，针对性 `git revert HEAD` 回退对应 task 的 commit 并修复。
验收全部通过后，在 `AGENTS.md` 已知注意事项末尾新增一条，记录「底部快捷键栏单行横向溢出滚动」设计（笼统一句话即可），并：
```bash
git add AGENTS.md
git commit -m "docs: 记录底部栏单行横滑滚动设计"
```
