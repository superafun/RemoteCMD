# 点空白处关闭所有 modal-overlay 弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `public/index.html` 中 5 个使用 `modal-overlay` 的弹窗加"点遮罩空白处即关闭"行为。

**Architecture:** 纯前端改动，不引入新函数/抽象。每个 `modal-overlay` 起始 div 加一个 inline `onclick="if(event.target===this)<关闭函数>()"`，利用事件冒泡——只有直接命中 overlay 本身（非内部 `modal-box` 或子元素）才触发关闭。底部「关闭」按钮与 CSS、server.js 全部不动。

**Tech Stack:** 原生 HTML/JS（inline onclick），浏览器事件模型。无框架、无构建。

## Global Constraints

- 纯前端改动，刷新网页即生效，**不重启服务器**、不改 `server.js`、不加 WebSocket 消息或协议。
- 每个弹窗按其既有关闭逻辑兜底：`closeSettingsModal()` / `closeSendKeysPanel()` / `closeEditor()` / 日志与可用按键直接 `this.remove()`。
- `event.target === this` 判定必须保留，保证点弹窗内部不误关。
- 既有关闭函数内部逻辑完全不改，只在其 overlay 起始 div 上加 onclick 属性。
- 一次独立变更一个 commit（AGENTS.md 规范）；执行后前端日志无需新增（非 WS 消息）。

---

### Task 1: 设置弹窗 + 日志弹窗加遮罩点击关闭

**Files:**
- Modify: `public/index.html:159`（设置弹窗 overlay 起始 div）
- Modify: `public/index.html:302`（日志弹窗 overlay 起始 div）

**Interfaces:**
- 复用现有 `closeSettingsModal()`（L295，会 null `settingsDiv`）与日志弹窗现有的 `this.closest('.modal-overlay').remove()` 关闭语义。

- [ ] **Step1: 改设置弹窗 overlay 起始 div**

`public/index.html:159` 由：
```js
            let html = '<div class="modal-overlay">';
```
改为：
```js
            let html = '<div class="modal-overlay" onclick="if(event.target===this)closeSettingsModal()">';
```

- [ ] **Step2: 改日志弹窗 overlay 起始 div**

`public/index.html:302` 由：
```js
            let html = '<div class="modal-overlay">';
```
改为：
```js
            let html = '<div class="modal-overlay" onclick="if(event.target===this)this.remove()">';
```

- [ ] **Step3: 提交**

```bash
cd c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add public/index.html
git commit -m "feat: 设置/日志弹窗支持点空白处关闭"
```

---

### Task 2: 发按键面板 + 快捷键编辑 + 可用按键加遮罩点击关闭

**Files:**
- Modify: `public/index.html:1141`（发按键面板 overlay 起始 div，带 `z-index:1000`）
- Modify: `public/index.html:1284`（快捷键编辑 overlay 起始 div）
- Modify: `public/index.html:1399`（可用按键 overlay 起始 div，带 `z-index:1000`）

**Interfaces:**
- 复用现有 `closeSendKeysPanel()`（L1169，会 null `sendKeysPanel` + `activeMods.clear()`）与 `closeEditor()`（L1390，会 null `editorDiv`）。
- 可用按键弹窗沿用其现有 `this.closest('.modal-overlay').remove()` 关闭语义。
- 注意保留 `style="z-index:1000;"` 不被破坏。

- [ ] **Step1: 改发按键面板 overlay 起始 div**

`public/index.html:1141` 由：
```js
            let html = '<div class="modal-overlay" style="z-index:1000;">';
```
改为：
```js
            let html = '<div class="modal-overlay" style="z-index:1000;" onclick="if(event.target===this)closeSendKeysPanel()">';
```

- [ ] **Step2: 改快捷键编辑 overlay 起始 div**

`public/index.html:1284` 由：
```js
            let html = '<div class="modal-overlay">';
```
改为：
```js
            let html = '<div class="modal-overlay" onclick="if(event.target===this)closeEditor()">';
```

- [ ] **Step3: 改可用按键 overlay 起始 div**

`public/index.html:1399` 由：
```js
            let html = '<div class="modal-overlay" style="z-index:1000;">';
```
改为：
```js
            let html = '<div class="modal-overlay" style="z-index:1000;" onclick="if(event.target===this)this.remove()">';
```

- [ ] **Step4: 提交**

```bash
cd c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add public/index.html
git commit -m "feat: 发按键/快捷键编辑/可用按键弹窗支持点空白处关闭"
```

---

### Task 3: 行为验证

**Files:**
- 无改动，仅验证。

**Interfaces:**
- 浏览器连接 `http://localhost:65433`（若后端已在跑，直接刷新即可；若未跑先 `npm start`）。
- 可用 Playwright（项目已配 `playwright-cli` 技能）或手动在浏览器逐项验证。

- [ ] **Step1: 启动/确认后端并打开页面**

```powershell
Get-NetTCPConnection -LocalPort 65433
```
确认端口有监听（未跑则 `npm start`）。浏览器打开页面并刷新加载新静态文件。

- [ ] **Step2: 逐项验证 5 个弹窗**

1. 点顶栏「设置」→ 弹窗打开；鼠标点弹窗四周的暗色遮罩空白处 → 弹窗关闭。
2. 设置弹窗内点「日志」→ 日志弹窗打开；点遮罩空白 → 日志弹窗关闭。
3. 底部「发按键」→ 面板打开；点遮罩空白 → 面板关闭（修饰键勾选状态应清空）。
4. 底部「编辑」打开快捷键编辑 → 点遮罩空白 → 编辑弹窗关闭。
5. 快捷键编辑内点「可用按键」→ 可用按键弹窗打开（叠在上层）；点遮罩空白 → 只关可用按键，快捷键编辑弹窗仍开。

- [ ] **Step3: 验证不误关 + 原按钮仍可用**

- 点弹窗内部（标题、输入框、按钮、滚动区）→ 弹窗**不**关闭。
- 各弹窗底部「关闭」按钮仍可正常关闭。

- [ ] **Step4: 提交验证结论（无代码改动则跳过 commit）**

若仅验证、无新文件，则不产生 commit；如有截图等证据文件，按用户指示决定是否入库。
