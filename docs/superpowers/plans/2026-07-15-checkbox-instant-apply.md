# 设置弹窗勾选框即时应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让设置弹窗的 3 个勾选框（显示滚动按钮 / 通知声音 / 通知 Toast）在勾选/取消时即时生效，去掉各自多余的「应用」按钮，并用瞬时「✓已应用」提示替代按钮反馈。

**Architecture:** 纯前端改动。在 checkbox 上挂 `onchange` 即时调用原 apply 函数（仍只 `wsSend`、服务端权威），把原 apply 函数里的 `fbBtn('btn-apply-...', true)` 换成新增的 `flashHint(spanId)` 在 checkbox 旁 span 闪现「✓已应用」1.5s。不新增 WS 消息、不碰 `server.js`。

**Tech Stack:** 原生 JS（内联在 `public/index.html`）+ CSS（`public/styles.css`）。无打包工具、无测试框架（AGENTS.md 明确：无测试框架、无 linter）。

## Global Constraints

- 服务端权威原则（AGENTS.md 注意事项 28）：apply 函数只 `wsSend`，本地状态由 `ws.onmessage` 接收侧广播后更新，绝不在发送前改本地变量。
- 所有 `ws.send()` 必须走 `wsSend(obj)` 统一入口（AGENTS.md 前端关键辅助函数）。
- 改 `public/index.html` 类静态文件刷新网页即生效；本次不改 `server.js`，无需重启后端。
- 每次代码修改完成后必须立即 `git commit`，禁止 `git add -A`。
- 复用现有绿色 `#4caf50`（与 `fbBtn` 一致）。

---

### Task 1: 新增 `.apply-hint` CSS 类

**Files:**
- Modify: `public/styles.css:111-113`（在 `.modal-row + .modal-row` 规则之后追加）

**Interfaces:**
- Produces: `.apply-hint` 类（供 index.html checkbox 行内 `<span class="apply-hint">` 使用）

- [ ] **Step 1: 在 styles.css 的 `.modal-row + .modal-row` 规则后追加 `.apply-hint` 类**

在 `public/styles.css` 第 113 行（`}` 结束 `.modal-row + .modal-row` 之后）追加：

```css
        .apply-hint {
            color: #4caf50;
            font-size: 12px;
            margin-left: 8px;
        }
```

- [ ] **Step 2: 确认改动**

确认 `public/styles.css` 中 `.modal-row + .modal-row { margin-top: 8px; }` 之后出现了 `.apply-hint` 三段声明，无语法错误。

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "style: 新增设置弹窗勾选框瞬时提示 .apply-hint 样式"
```

---

### Task 2: 勾选框即时应用（去掉按钮 + onchange + flashHint）

**Files:**
- Modify: `public/index.html:205-209`（显示滚动按钮行）
- Modify: `public/index.html:236-240`（通知声音行）
- Modify: `public/index.html:242-246`（通知 Toast 行）
- Modify: `public/index.html:362-368`（fbBtn 定义之后新增 flashHint helper）
- Modify: `public/index.html:409-413`（applySettingsShowScrollButtons）
- Modify: `public/index.html:455-459`（applySettingsBellSoundEnabled）
- Modify: `public/index.html:461-465`（applySettingsBellToastEnabled）

**Interfaces:**
- Consumes: `wsSend(obj)`（AGENTS.md 统一发送入口）、`.apply-hint` 类（Task 1）
- Produces: `flashHint(spanId)` helper、3 个挂了 `onchange` 的 checkbox、3 个 `hint-*` span 的 id（`hint-showScrollButtons` / `hint-bellSoundEnabled` / `hint-bellToastEnabled`）

- [ ] **Step 1: 修改「显示滚动按钮」行 HTML（去掉应用按钮，加 onchange + hint span）**

把 `public/index.html` 中：

```js
            // 显示滚动按钮
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsShowScrollButtonsInput"> 显示滚动按钮</label>';
            html += '<button class="btn-primary" id="btn-apply-showScrollButtons" onclick="applySettingsShowScrollButtons()">应用</button>';
            html += '</div>';
```

改为：

```js
            // 显示滚动按钮
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsShowScrollButtonsInput" onchange="applySettingsShowScrollButtons()"> 显示滚动按钮</label>';
            html += '<span id="hint-showScrollButtons" class="apply-hint"></span>';
            html += '</div>';
```

- [ ] **Step 2: 修改「通知声音」行 HTML**

把：

```js
            // 通知声音开关
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsBellSoundEnabledInput"> 通知声音</label>';
            html += '<button class="btn-primary" id="btn-apply-bellSoundEnabled" onclick="applySettingsBellSoundEnabled()">应用</button>';
            html += '</div>';
```

改为：

```js
            // 通知声音开关
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsBellSoundEnabledInput" onchange="applySettingsBellSoundEnabled()"> 通知声音</label>';
            html += '<span id="hint-bellSoundEnabled" class="apply-hint"></span>';
            html += '</div>';
```

- [ ] **Step 3: 修改「通知 Toast」行 HTML**

把：

```js
            // 通知 Toast 开关
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsBellToastEnabledInput"> 通知 Toast</label>';
            html += '<button class="btn-primary" id="btn-apply-bellToastEnabled" onclick="applySettingsBellToastEnabled()">应用</button>';
            html += '</div>';
```

改为：

```js
            // 通知 Toast 开关
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsBellToastEnabledInput" onchange="applySettingsBellToastEnabled()"> 通知 Toast</label>';
            html += '<span id="hint-bellToastEnabled" class="apply-hint"></span>';
            html += '</div>';
```

- [ ] **Step 4: 在 `fbBtn` 定义之后新增 `flashHint` helper**

在 `public/index.html` 中 `fbBtn` 函数定义（结束于 `}` 的 `setTimeout(...)` 关闭）之后追加：

```js
        function flashHint(spanId) {
            const el = document.getElementById(spanId);
            if (!el) return;
            el.textContent = '✓已应用';
            setTimeout(() => { if (el) el.textContent = ''; }, 1500);
        }
```

- [ ] **Step 5: 改 `applySettingsShowScrollButtons` 用 flashHint**

把：

```js
        function applySettingsShowScrollButtons() {
            const v = document.getElementById('settingsShowScrollButtonsInput').checked;
            wsSend({ type: 'show_scroll_buttons', data: v });
            fbBtn('btn-apply-showScrollButtons', true);
        }
```

改为：

```js
        function applySettingsShowScrollButtons() {
            const v = document.getElementById('settingsShowScrollButtonsInput').checked;
            wsSend({ type: 'show_scroll_buttons', data: v });
            flashHint('hint-showScrollButtons');
        }
```

- [ ] **Step 6: 改 `applySettingsBellSoundEnabled` 用 flashHint**

把：

```js
        function applySettingsBellSoundEnabled() {
            const v = document.getElementById('settingsBellSoundEnabledInput').checked;
            wsSend({ type: 'bell_sound_enabled', data: v });
            fbBtn('btn-apply-bellSoundEnabled', true);
        }
```

改为：

```js
        function applySettingsBellSoundEnabled() {
            const v = document.getElementById('settingsBellSoundEnabledInput').checked;
            wsSend({ type: 'bell_sound_enabled', data: v });
            flashHint('hint-bellSoundEnabled');
        }
```

- [ ] **Step 7: 改 `applySettingsBellToastEnabled` 用 flashHint**

把：

```js
        function applySettingsBellToastEnabled() {
            const v = document.getElementById('settingsBellToastEnabledInput').checked;
            wsSend({ type: 'bell_toast_enabled', data: v });
            fbBtn('btn-apply-bellToastEnabled', true);
        }
```

改为：

```js
        function applySettingsBellToastEnabled() {
            const v = document.getElementById('settingsBellToastEnabledInput').checked;
            wsSend({ type: 'bell_toast_enabled', data: v });
            flashHint('hint-bellToastEnabled');
        }
```

- [ ] **Step 8: 确认无残留引用**

在 `public/index.html` 中确认不再存在 `btn-apply-showScrollButtons` / `btn-apply-bellSoundEnabled` / `btn-apply-bellToastEnabled` 任何引用（按钮已删、fbBtn 调用已改）。

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: 设置弹窗 3 个勾选框改为即时应用，去掉多余应用按钮"
```

---

### Task 3: 浏览器手动验收

**Files:**
- 无文件改动（验收步骤）

**Interfaces:**
- Consumes: 已部署的前端静态文件（刷新即加载）

- [ ] **Step 1: 确认后端在跑（前端无需重启）**

```powershell
Get-NetTCPConnection -LocalPort <端口>
```

若返回监听中的连接即说明后端在跑；纯前端改动只需刷新网页。

- [ ] **Step 2: 浏览器验收**

打开 `http://localhost:<端口>/`，开设置弹窗，逐项验证：

1. 「显示滚动按钮 / 通知声音 / 通知 Toast」三行**不再有「应用」按钮**。
2. 勾选或取消任一 checkbox：
   - checkbox 旁闪现绿色「✓已应用」，约 1.5s 后消失。
   - 前端日志（点「日志」按钮）出现对应记录（如「滚动按钮显示状态同步为 显示/隐藏」「通知声音已开启/关闭」「通知 Toast 已开启/关闭」）。
   - 若开第二个浏览器窗口，对应 UI/行为同步变化（服务端权威）。
3. 重复快速勾选/取消，提示能正常重置，无报错。

- [ ] **Step 3: 汇报**

向用户口头汇报改动文件与验收结果（依据 AGENTS.md：改完必须主动汇报文件 + 是否需重启；本次纯前端、无需重启）。

---

## Self-Review

1. **Spec coverage:** 3 个 checkbox 去按钮（Task 2 Step1-3）、onchange 即时发送（Step1-3 + Step5-7 apply 函数仍 `wsSend`）、`flashHint` 瞬时提示替代 `fbBtn`（Task 2 Step4、Step5-7）、`.apply-hint` CSS（Task 1）、服务端权威不变（apply 函数只 wsSend）、数值输入框不变（spec 明确，计划未触碰）。✓ 全覆盖。
2. **Placeholder scan:** 无 TBD/TODO，每步均有完整代码或确切命令。✓
3. **Types consistency:** `flashHint(spanId)` 在 Task 2 Step4 定义，Step5-7 用字符串 id 调用，span id `hint-showScrollButtons/hint-bellSoundEnabled/hint-bellToastEnabled` 在 Step1-3 创建并在 Step5-7 引用，完全一致。✓
