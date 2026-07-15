# 输入条「焦点丢失隐藏」改为可设置项 + Esc/换行隐藏交互 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将输入条「焦点丢失隐藏」从写死行为改为可设置开关（默认开、多端同步），并把 Esc 改为「有内容清空 / 无内容隐藏」。

**Architecture:** 复用现有设置多端同步链路——`config.json` 默认值 + 兜底 → 连接下发 → WS 双向消息 → 广播 → 前端接收更新；前端在「输入条动作」分组新增勾选框（即时生效），并在 `blur`/`keydown(Esc)` 监听处按开关与内容分流。

**Tech Stack:** Node.js + Express + `ws`（服务端，文件 `server.js`）；原生前端（`public/index.html`，含内联 JS，无构建、无测试框架）。

## Global Constraints

- 新增设置项默认值为 `true`（保持当前默认行为，向后兼容）。
- 配置键 `inputBarHideOnBlur`，WS 消息类型 `input_bar_hide_on_blur`，类型 `boolean`。
- 勾选框放「输入条动作」分组最前（checkbox 置顶），`onchange` 即时生效，无「应用」按钮（与同分组 `发送后关闭输入条` 一致）。
- Esc 的清空/隐藏仅当焦点在输入条内时生效（监听本就绑在 `inputBarText`，不新增全局监听）。
- 换行按钮空内容隐藏输入条保持现状，不改动。
- 不改动 `public/term-session.js`、`public/styles.css` 及其他设置项逻辑。
- 服务端对 `data` 做 `typeof boolean` 校验，非法值直接 `return` 不下发。

---

## 文件结构

- `server.js`：配置默认值 + 兜底 + 连接下发 + 消息处理分支（集中改造）。
- `public/index.html`：变量声明、设置弹窗渲染、apply 函数、弹窗回填、WS 接收分支、blur 门控、Esc 分流（集中改造）。

---

### Task 1: 服务端配置默认值 + 兜底 + 下发 + 消息处理

**Files:**
- Modify: `server.js:27-30`（默认对象）
- Modify: `server.js:69-70`（兜底分支，紧邻 `inputBarCloseAfterSend`）
- Modify: `server.js:212`（连接下发，紧邻 `input_bar_close_after_send`）
- Modify: `server.js:334`（消息处理，紧邻 `input_bar_close_after_send` 分支）

**Interfaces:**
- Consumes: 无（独立任务，仅新增配置键与消息分支）。
- Produces: 配置键 `inputBarHideOnBlur`（`config.inputBarHideOnBlur`，boolean）；WS 类型 `input_bar_hide_on_blur`；前端后续任务依赖此键与类型名一致。

- [ ] **Step 1: 在默认对象新增 `inputBarHideOnBlur: true`**

定位 `server.js` 默认对象结尾（`inputBarCloseAfterSend: false,` 与 `enterDelayMs: 300` 之间），改为：

```js
            inputBarButtonAction: 'newline',
            inputBarEnterAction: 'send',
            inputBarCloseAfterSend: false,
            enterDelayMs: 300,
            inputBarHideOnBlur: true
```

- [ ] **Step 2: 在兜底分支新增 `inputBarHideOnBlur` 兜底**

定位 `if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;` 之后，新增一行：

```js
    if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
    if (typeof cfg.inputBarHideOnBlur !== 'boolean') cfg.inputBarHideOnBlur = true;
    if (typeof cfg.enterDelayMs !== 'number' || cfg.enterDelayMs < 50 || cfg.enterDelayMs > 3000) cfg.enterDelayMs = 300;
```

- [ ] **Step 3: 在连接下发处新增一条广播**

定位 `ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));` 之后，新增：

```js
    ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));
    ws.send(JSON.stringify({ type: 'input_bar_hide_on_blur', data: config.inputBarHideOnBlur }));
    ws.send(JSON.stringify({ type: 'enter_delay_ms', data: config.enterDelayMs }));
```

- [ ] **Step 4: 新增消息处理分支**

定位 `input_bar_close_after_send` 分支结束（`saveConfig(config);` 与 `else if (type === 'enter_delay_ms')` 之间），插入：

```js
        else if (type === 'input_bar_close_after_send') {
            if (typeof data !== 'boolean') return;
            config.inputBarCloseAfterSend = data;
            broadcast({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend });
            saveConfig(config);
        }
        else if (type === 'input_bar_hide_on_blur') {
            if (typeof data !== 'boolean') return;
            config.inputBarHideOnBlur = data;
            broadcast({ type: 'input_bar_hide_on_blur', data: config.inputBarHideOnBlur });
            saveConfig(config);
        }
        else if (type === 'enter_delay_ms') {
```

- [ ] **Step 5: 语法检查**

Run: `node --check server.js`
Expected: 无输出、退出码 0（语法正确）。

- [ ] **Step 6: 提交**

```bash
git add server.js
git commit -m "feat: 服务端新增 inputBarHideOnBlur 设置项默认值/兜底/下发/消息处理"
```

---

### Task 2: 前端变量 + 设置弹窗 + apply + 回填 + WS 接收

**Files:**
- Modify: `public/index.html:85`（变量声明，紧邻 `enterDelayMs`）
- Modify: `public/index.html:229-231`（「输入条动作」分组标题下方插入 checkbox 行）
- Modify: `public/index.html:349`（弹窗回填，紧邻 `inputBarCloseAfterSend` 回填）
- Modify: `public/index.html:512`（apply 函数，紧邻 `applySettingsInputBarCloseAfterSend`）
- Modify: `public/index.html:894`（WS 接收，紧邻 `input_bar_close_after_send` 分支）

**Interfaces:**
- Consumes: Task 1 的 `input_bar_hide_on_blur` WS 类型与 `config.inputBarHideOnBlur` 语义。
- Produces: 全局变量 `inputBarHideOnBlur`（boolean）；函数 `applySettingsInputBarHideOnBlur()`；DOM id `settingsInputBarHideOnBlurInput`、`hint-inputBarHideOnBlur`；Task 3 的 blur/Esc 逻辑依赖 `inputBarHideOnBlur` 变量。

- [ ] **Step 1: 新增全局变量**

定位 `let enterDelayMs = 300;   // 输入条回车停顿(ms)，设置可改、多端同步` 之后，新增：

```js
        let enterDelayMs = 300;   // 输入条回车停顿(ms)，设置可改、多端同步
        let inputBarHideOnBlur = true;
```

- [ ] **Step 2: 在「输入条动作」分组最前插入 checkbox 行**

定位 `html += '<div class="modal-group-title">输入条动作</div>';` 之后（原注释 `// 发送后关闭输入条` 之前），插入：

```js
            html += '<div class="modal-group-title">输入条动作</div>';

            // 焦点丢失时隐藏输入条
            html += '<div class="modal-row">';
            html += '<label class="modal-label"><input type="checkbox" id="settingsInputBarHideOnBlurInput" onchange="applySettingsInputBarHideOnBlur()"> 焦点丢失时隐藏输入条</label>';
            html += '<span id="hint-inputBarHideOnBlur" class="apply-hint"></span>';
            html += '</div>';

            // 发送后关闭输入条
            html += '<div class="modal-row">';
```

- [ ] **Step 3: 弹窗打开时回填勾选状态**

定位 `document.getElementById('settingsInputBarCloseAfterSendInput').checked = inputBarCloseAfterSend;` 之后，新增：

```js
            document.getElementById('settingsInputBarCloseAfterSendInput').checked = inputBarCloseAfterSend;
            document.getElementById('settingsInputBarHideOnBlurInput').checked = inputBarHideOnBlur;
```

- [ ] **Step 4: 新增 apply 函数（即时生效，无「应用」按钮）**

定位 `function applySettingsInputBarCloseAfterSend() {` 函数整体之后（其结尾 `flashHint('hint-inputBarCloseAfterSend'); }` 之后），新增：

```js
        function applySettingsInputBarHideOnBlur() {
            const v = document.getElementById('settingsInputBarHideOnBlurInput').checked;
            wsSend({ type: 'input_bar_hide_on_blur', data: v });
            flashHint('hint-inputBarHideOnBlur');
        }
```

- [ ] **Step 5: WS 接收侧新增分支**

定位 `} else if (msg.type === 'input_bar_close_after_send') {` 分支结束（`addFrontendLog('发送后关闭输入条同步为 ' + ...);` 之后、`} else if (msg.type === 'enter_delay_ms') {` 之前），插入：

```js
                    } else if (msg.type === 'input_bar_close_after_send') {
                        inputBarCloseAfterSend = msg.data;
                        addFrontendLog('发送后关闭输入条同步为 ' + (inputBarCloseAfterSend ? '关闭' : '保持展开'), 'in');
                    } else if (msg.type === 'input_bar_hide_on_blur') {
                        inputBarHideOnBlur = msg.data;
                        addFrontendLog('焦点丢失隐藏输入条同步为 ' + (inputBarHideOnBlur ? '隐藏' : '保持展开'), 'in');
                    } else if (msg.type === 'enter_delay_ms') {
```

- [ ] **Step 6: 语法检查**

Run: 用浏览器开发者工具打开页面，或在 `public/index.html` 中确认无 JS 语法错误（可临时用 `node --check` 不适用，因含 HTML；改为人工核对括号配对）。
Expected: 设置弹窗「输入条动作」分组最前出现「焦点丢失时隐藏输入条」勾选框，默认勾选；勾选/取消触发 `✓已应用` 提示，且 WS 发送 `input_bar_hide_on_blur` 消息（见浏览器日志弹窗中的 `→` 出站记录）。

- [ ] **Step 7: 提交**

```bash
git add public/index.html
git commit -m "feat: 前端新增焦点丢失隐藏输入条设置项 UI/同步/回填"
```

---

### Task 3: 交互逻辑——blur 门控 + Esc 分流

**Files:**
- Modify: `public/index.html:1396`（Esc keydown 分支）
- Modify: `public/index.html:1403-1408`（blur 监听）

**Interfaces:**
- Consumes: Task 2 的全局变量 `inputBarHideOnBlur`、函数 `clearInputBar()` / `closeInputBar()` / `closeInputBarPreserve()`。
- Produces: 无（行为改动，供后续浏览器验证）。

- [ ] **Step 1: 修改 Esc 分支为有内容清空 / 无内容隐藏**

定位 `if (e.key === 'Escape') { e.preventDefault(); clearInputBar(); }`，改为：

```js
            if (e.key === 'Escape') {
                e.preventDefault();
                if (inputBarText.value) clearInputBar();   // 有内容：清空、保持展开、焦点留输入框
                else closeInputBar();                       // 无内容：隐藏输入条
            }
```

- [ ] **Step 2: 修改 blur 监听加开关门控**

定位现有 blur 监听：

```js
        inputBarText.addEventListener('blur', (e) => {
            if (inputBarWrap.style.display !== 'flex') return;   // 已关闭则忽略，防止程序化 close 后的二次触发
            const r = e.relatedTarget;
            if (r && inputBarWrap.contains(r)) return;            // 焦点仍在输入条内（如换行按钮），不关闭
            closeInputBarPreserve();                             // 点外部/终端：关闭但保留草稿
        });
```

改为：

```js
        inputBarText.addEventListener('blur', (e) => {
            if (inputBarWrap.style.display !== 'flex') return;   // 已关闭则忽略，防止程序化 close 后的二次触发
            if (!inputBarHideOnBlur) return;                     // 设置关闭：失焦不隐藏
            const r = e.relatedTarget;
            if (r && inputBarWrap.contains(r)) return;            // 焦点仍在输入条内（如换行按钮），不关闭
            closeInputBarPreserve();                             // 点外部/终端：关闭但保留草稿
        });
```

- [ ] **Step 3: 语法/人工核对**

Run: 人工核对 `inputBarText` 的 `keydown` 监听绑定未变（仍绑在输入框自身，`Esc` 仅焦点在输入条内才触发）；`blur` 监听逻辑分支正确。
Expected: 焦点在终端、按 Esc → 输入条不被清空/隐藏（走终端正常 Esc）。

- [ ] **Step 4: 提交**

```bash
git add public/index.html
git commit -m "feat: blur 加焦点丢失隐藏开关门控；Esc 改为有内容清空/无内容隐藏"
```

---

### Task 4: 浏览器端验证（手动）

**Files:** 无（验证步骤）

**验证清单（按 spec 第「测试验证」节）：**

- [ ] **默认开（升级后现状）**：展开输入条 → 点击页面其它处或终端 → 输入条隐藏且保留草稿；输入条内有内容按 Esc → 内容清空、保持展开；空内容按 Esc → 输入条隐藏；换行按钮空内容 → 输入条隐藏。
- [ ] **设置中关闭并多端同步**：在 A 端「输入条动作」取消勾选「焦点丢失时隐藏输入条」→ A、B 端日志均提示「焦点丢失隐藏输入条同步为 保持展开」；失焦后输入条常驻不隐藏。
- [ ] **关闭后仍可隐藏**：空内容按 Esc、空内容按换行按钮 → 输入条仍收起（不会卡死）。
- [ ] **持久化**：刷新页面 → 开关状态保持（来自 `config.json` 下发）。
- [ ] **焦点边界**：焦点在终端时按 Esc → 走终端正常 Esc，输入条不被清空/隐藏。

- [ ] **Step: 全量提交确认**

Run: `git log --oneline -4`
Expected: 看到 Task 1-3 的三个 feat 提交，无遗漏。
