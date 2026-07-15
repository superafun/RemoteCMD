# 输入条动作可配置（多端同步）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让输入条的「右侧按钮动作」「Enter 键动作」「发送后是否关闭」三个行为可在设置弹窗随时调整，并多端同步（config.json + WebSocket 双向）。

**Architecture:** 沿用现有 `swipe_*` 设置项的完整同步链路：config.json 字段 → server.js `loadConfig` 默认值+校验 → 连接时 `ws.send` 下发 → ws handler 校验+`saveConfig`+`broadcast` → 前端 `apply*` 只 `wsSend`（服务端权威）→ 前端接收侧更新变量+日志。纯前端行为接线：右侧按钮改分发函数 + 动态文字，Enter 键按设置分支，发送后按设置收起/保持。

**Tech Stack:** Node.js（Express 5 + ws 8 + node-pty），前端单文件原生 JS（`public/index.html`，无打包工具）。

## Global Constraints

- 多端同步：每个设置项都必须同时走 config.json 持久化 + WebSocket 双向（下发 + 变更广播）。
- 服务端权威：`apply*` 函数只 `wsSend`，本地状态由 `ws.onmessage` 接收侧 `msg.data` 赋值更新，不可在 `wsSend` 前乐观修改本地状态。
- 严禁过度设计：不做任何防呆/逃生通道（无 Shift+Enter 兜底）；用户配错自己改回设置即可。
- 默认值保持现状：`inputBarButtonAction='newline'`（右侧按钮=换行）、`inputBarEnterAction='send'`（Enter=发送）、`inputBarCloseAfterSend=false`（发送后保持展开）。
- 连接顺序：三条新消息在 list 之后下发（不读于 list handler），放在 `swipe_classify`/`show_scroll_buttons` 之后。
- 控件约定：枚举类用 `<select>` + 应用按钮（`fbBtn` 反馈）；布尔勾选框即时应用（`onchange` + `flashHint` 闪「✓已应用」）。
- 所有 `ws.send` 必须走 `wsSend()` 封装（`public/index.html`），禁止直接 `ws.send()`。
- 无测试框架（AGENTS.md 明确）：本计划用「配置落盘检查 + 手动浏览器验证」替代单测；每任务末提交。
- 提交纪律：每次改动只 `git add` 涉及的精确文件，禁止 `git add -A`；一个独立变更一个 commit。
- 改 `server.js` 后需用户执行 `npm run restart`（AI 不私自重启，只通知）。

---

### Task 1: server.js loadConfig 默认值 + 校验

**Files:**
- Modify: `server.js:11-27`（默认对象）、`server.js:56-62`（校验区域）

**Interfaces:**
- Consumes: 无
- Produces: `config.inputBarButtonAction` / `config.inputBarEnterAction` / `config.inputBarCloseAfterSend` 三个字段，供 Task 2（下发）、Task 3（handler）使用

- [ ] **Step 1: 在默认对象 `def` 末尾（bellBeepDurationMs 行之后）追加三个字段**

```js
            bellBeepDurationMs: 300,
            inputBarButtonAction: 'newline',
            inputBarEnterAction: 'send',
            inputBarCloseAfterSend: false
```

- [ ] **Step 2: 在 `loadConfig` 校验区域（bellBeepDurationMs 校验行之后）追加三个字段校验**

```js
    if (typeof cfg.bellBeepDurationMs !== 'number' || cfg.bellBeepDurationMs < 50 || cfg.bellBeepDurationMs > 2000) cfg.bellBeepDurationMs = 300;
    if (cfg.inputBarButtonAction !== 'newline' && cfg.inputBarButtonAction !== 'send') cfg.inputBarButtonAction = 'newline';
    if (cfg.inputBarEnterAction !== 'newline' && cfg.inputBarEnterAction !== 'send') cfg.inputBarEnterAction = 'send';
    if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
```

- [ ] **Step 3: 手动验证默认值生效**

运行：`node -e "const c=require('./server.js')" ` 不可行（server.js 会启动服务）。改为检查：先确认 `config.json` 存在且不含这三个字段，启动后 `loadConfig` 会在内存填默认；或临时 `console.log(config.inputBarButtonAction)` 在 `let config = loadConfig();` 之后，启动一次后删除该 log。

预期：`config.inputBarButtonAction === 'newline'`、`config.inputBarEnterAction === 'send'`、`config.inputBarCloseAfterSend === false`。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: loadConfig 新增输入条三动作配置项默认值与校验"
```

---

### Task 2: server.js 连接时下发

**Files:**
- Modify: `server.js:198-200`（连接时 ws.send 区块）

**Interfaces:**
- Consumes: `config.inputBarButtonAction` / `config.inputBarEnterAction` / `config.inputBarCloseAfterSend`（Task 1 产出）
- Produces: 三个 S→C 消息 `input_bar_button_action` / `input_bar_enter_action` / `input_bar_close_after_send`，供前端接收侧（Task 6）消费

- [ ] **Step 1: 在 `show_scroll_buttons` 下发之后追加三条消息**

```js
    ws.send(JSON.stringify({ type: 'show_scroll_buttons', data: config.showScrollButtons }));
    ws.send(JSON.stringify({ type: 'input_bar_button_action', data: config.inputBarButtonAction }));
    ws.send(JSON.stringify({ type: 'input_bar_enter_action', data: config.inputBarEnterAction }));
    ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));
```

- [ ] **Step 2: 手动验证顺序**

检查代码确认三条新 `ws.send` 位于 `swipe_classify`/`show_scroll_buttons` 之后、`max_buffer` 之前，且均在 `buildListMsg()` 的 `ws.send(list)` 之后（符合 note 29「不读于 list handler 的设置可放 list 之后」）。

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: 连接时下发输入条三动作设置"
```

---

### Task 3: server.js ws handler

**Files:**
- Modify: `server.js:299-304`（`show_scroll_buttons` handler 之后）

**Interfaces:**
- Consumes: 客户端发来的 `input_bar_button_action` / `input_bar_enter_action` / `input_bar_close_after_send`（前端 Task 5 的 apply 产出）
- Produces: `broadcast` 出去的同名消息，供所有客户端接收侧（Task 6）消费

- [ ] **Step 1: 在 `show_scroll_buttons` 分支之后追加三个 handler 分支**

```js
        else if (type === 'show_scroll_buttons') {
            if (typeof data !== 'boolean') return;
            config.showScrollButtons = data;
            broadcast({ type: 'show_scroll_buttons', data: config.showScrollButtons });
            saveConfig(config);
        }
        else if (type === 'input_bar_button_action') {
            if (data !== 'newline' && data !== 'send') return;
            config.inputBarButtonAction = data;
            broadcast({ type: 'input_bar_button_action', data: config.inputBarButtonAction });
            saveConfig(config);
        }
        else if (type === 'input_bar_enter_action') {
            if (data !== 'newline' && data !== 'send') return;
            config.inputBarEnterAction = data;
            broadcast({ type: 'input_bar_enter_action', data: config.inputBarEnterAction });
            saveConfig(config);
        }
        else if (type === 'input_bar_close_after_send') {
            if (typeof data !== 'boolean') return;
            config.inputBarCloseAfterSend = data;
            broadcast({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend });
            saveConfig(config);
        }
```

- [ ] **Step 2: 手动验证非法值被拒收**

检查：`data` 为非法枚举（如 `'foo'`）或非布尔时 `return`，不落盘、不广播。枚举校验与 Task 1 默认值一致。

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: 新增输入条三动作 ws handler（校验+落盘+广播）"
```

---

### Task 4: 前端顶层变量 + 设置弹窗 HTML + 值同步

**Files:**
- Modify: `public/index.html:81`（顶层变量）、`public/index.html:205-209`（弹窗 HTML）、`public/index.html:282`（openSettingsModal 同步）

**Interfaces:**
- Consumes: 无（独立前置任务）
- Produces: 顶层变量 `inputBarButtonAction` / `inputBarEnterAction` / `inputBarCloseAfterSend`（供 Task 5/6/7 使用）；两个 `<select>` 的 id `settingsInputBarButtonActionInput` / `settingsInputBarEnterActionInput`；勾选框 id `settingsInputBarCloseAfterSendInput` 与提示 span `hint-inputBarCloseAfterSend`（供 Task 5 apply 函数引用）

- [ ] **Step 1: 顶层变量（showScrollButtons 行之后）**

```js
        let showScrollButtons = true;
        let inputBarButtonAction = 'newline';
        let inputBarEnterAction = 'send';
        let inputBarCloseAfterSend = false;
```

- [ ] **Step 2: 设置弹窗 HTML（"显示滚动按钮"行之后追加三行）**

```js
            html += '<div class="modal-row">';
            html += '右侧按钮动作 <select id="settingsInputBarButtonActionInput">'
                  + '<option value="newline">换行</option><option value="send">发送</option></select>';
            html += '<button class="btn-primary" id="btn-apply-inputBarButtonAction" onclick="applySettingsInputBarButtonAction()">应用</button>';
            html += '</div>';

            html += '<div class="modal-row">';
            html += 'Enter 键动作 <select id="settingsInputBarEnterActionInput">'
                  + '<option value="newline">换行</option><option value="send">发送</option></select>';
            html += '<button class="btn-primary" id="btn-apply-inputBarEnterAction" onclick="applySettingsInputBarEnterAction()">应用</button>';
            html += '</div>';

            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsInputBarCloseAfterSendInput" onchange="applySettingsInputBarCloseAfterSend()"> 发送后关闭输入条</label>';
            html += '<span id="hint-inputBarCloseAfterSend" class="apply-hint"></span>';
            html += '</div>';
```

- [ ] **Step 3: openSettingsModal 值同步（settingsShowScrollButtonsInput.checked 行之后）**

```js
            document.getElementById('settingsShowScrollButtonsInput').checked = showScrollButtons;
            document.getElementById('settingsInputBarButtonActionInput').value = inputBarButtonAction;
            document.getElementById('settingsInputBarEnterActionInput').value = inputBarEnterAction;
            document.getElementById('settingsInputBarCloseAfterSendInput').checked = inputBarCloseAfterSend;
```

- [ ] **Step 4: 手动验证弹窗渲染**

刷新页面 → 打开设置弹窗 → 确认新增三行存在，下拉框默认分别为「换行」「发送」，勾选框默认未勾选。

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: 前端新增输入条三动作设置弹窗控件与顶层变量"
```

---

### Task 5: 前端 apply 函数

**Files:**
- Modify: `public/index.html:416-420`（`applySettingsShowScrollButtons` 之后）

**Interfaces:**
- Consumes: Task 4 的控件 id（`settingsInputBarButtonActionInput` 等）
- Produces: `wsSend({type:'input_bar_button_action'|'input_bar_enter_action'|'input_bar_close_after_send', data})`，供 server.js Task 3 handler 接收

- [ ] **Step 1: 追加三个 apply 函数**

```js
        function applySettingsInputBarButtonAction() {
            const v = document.getElementById('settingsInputBarButtonActionInput').value;
            if (v === 'newline' || v === 'send') {
                wsSend({ type: 'input_bar_button_action', data: v });
                fbBtn('btn-apply-inputBarButtonAction', true);
            } else {
                fbBtn('btn-apply-inputBarButtonAction', false);
            }
        }
        function applySettingsInputBarEnterAction() {
            const v = document.getElementById('settingsInputBarEnterActionInput').value;
            if (v === 'newline' || v === 'send') {
                wsSend({ type: 'input_bar_enter_action', data: v });
                fbBtn('btn-apply-inputBarEnterAction', true);
            } else {
                fbBtn('btn-apply-inputBarEnterAction', false);
            }
        }
        function applySettingsInputBarCloseAfterSend() {
            const v = document.getElementById('settingsInputBarCloseAfterSendInput').checked;
            wsSend({ type: 'input_bar_close_after_send', data: v });
            flashHint('hint-inputBarCloseAfterSend');
        }
```

- [ ] **Step 2: 手动验证发送**

刷新页面 → 打开设置 → 把「右侧按钮动作」改为「发送」点应用 → 打开浏览器 DevTools 控制台（用户所说的「控制台」= 浏览器 DevTools，非后端），在 wsSend 处或网络面板确认发出 `{"type":"input_bar_button_action","data":"send"}`；按钮反馈变绿（fbBtn true）。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 前端输入条三动作 apply 函数（服务端权威，只 wsSend）"
```

---

### Task 6: 前端接收侧 handler

**Files:**
- Modify: `public/index.html:780-783`（`show_scroll_buttons` 接收分支之后）

**Interfaces:**
- Consumes: server.js Task 2 下发 / Task 3 广播的同名消息
- Produces: 更新 `inputBarButtonAction` / `inputBarEnterAction` / `inputBarCloseAfterSend` 三个变量；`applyInputBarButtonLabel()`（Task 7 定义）在按钮动作变更时刷新按钮文字

- [ ] **Step 1: 追加三个接收分支**

```js
                    } else if (msg.type === 'show_scroll_buttons') {
                        showScrollButtons = msg.data;
                        applyScrollButtonsVisibility();
                        addFrontendLog('滚动按钮显示状态同步为 ' + (showScrollButtons ? '显示' : '隐藏'), 'in');
                    } else if (msg.type === 'input_bar_button_action') {
                        inputBarButtonAction = msg.data;
                        applyInputBarButtonLabel();
                        addFrontendLog('右侧按钮动作同步为 ' + (inputBarButtonAction === 'send' ? '发送' : '换行'), 'in');
                    } else if (msg.type === 'input_bar_enter_action') {
                        inputBarEnterAction = msg.data;
                        addFrontendLog('Enter 键动作同步为 ' + (inputBarEnterAction === 'send' ? '发送' : '换行'), 'in');
                    } else if (msg.type === 'input_bar_close_after_send') {
                        inputBarCloseAfterSend = msg.data;
                        addFrontendLog('发送后关闭输入条同步为 ' + (inputBarCloseAfterSend ? '关闭' : '保持展开'), 'in');
                    }
```

- [ ] **Step 2: 手动验证多端同步**

两个浏览器窗口连同一服务器 → 窗口 A 改「右侧按钮动作」为「发送」点应用 → 窗口 B 收到同步、日志出现「右侧按钮动作同步为 发送」、按钮文字变「发送」。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 前端接收输入条三动作广播并更新状态"
```

---

### Task 7: 前端行为接线

**Files:**
- Modify: `public/index.html:57`（按钮 onclick）、`public/index.html:1211-1218`（`openInputBar` 区域，新增标签刷新调用）、`public/index.html:1248-1256`（`insertNewline` 附近新增两个函数）、`public/index.html:1257-1268`（`sendInputBar` 内 clear 分支）、`public/index.html:1270-1273`（keydown 分支）

**Interfaces:**
- Consumes: Task 4/6 的变量 `inputBarButtonAction` / `inputBarEnterAction` / `inputBarCloseAfterSend`；既有 `insertNewline()` / `sendInputBar()` / `clearInputBar()` / `closeInputBar()`
- Produces: `inputBarRightButton()`（右侧按钮分发）、`applyInputBarButtonLabel()`（按钮文字刷新）；行为改变：Enter 按设置分支、发送后按设置收起/保持

- [ ] **Step 1: 右侧按钮 onclick 改为分发**

```html
<button id="inputBarSend" onclick="inputBarRightButton()">换行</button>
```

- [ ] **Step 2: 新增两个函数（放在 `insertNewline` 函数之后）**

```js
        // 右侧按钮：按当前设置决定是换行还是发送
        function inputBarRightButton() {
            if (inputBarButtonAction === 'send') sendInputBar();
            else insertNewline();
        }
        // 按钮文字随设置切「换行」/「发送」
        function applyInputBarButtonLabel() {
            const btn = document.getElementById('inputBarSend');
            if (btn) btn.textContent = (inputBarButtonAction === 'send') ? '发送' : '换行';
        }
```

- [ ] **Step 3: 在 `openInputBar` 内刷新按钮文字（focus 之前加一行）**

```js
        function openInputBar() {
            inputBarBtn.style.display = 'none';      // 展开时连同输入条按钮一起隐藏
            hotkeysListEl.style.display = 'none';    // 展开时隐藏快捷键栏
            inputBarWrap.style.display = 'flex';     // 输入条独占整行
            applyInputBarButtonLabel();              // 按当前设置刷新右侧按钮文字
            // 不再清空 value：保留上次未发送草稿，autoGrow 按现有内容重算高度
            autoGrow(inputBarText);
            inputBarText.focus();
        }
```

- [ ] **Step 4: Enter 键按设置分支（替换原 keydown 监听）**

```js
        inputBarText.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); clearInputBar(); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (inputBarEnterAction === 'send') sendInputBar();
                else insertNewline();
            }
        });
```

- [ ] **Step 5: 发送后按设置收起/保持（`sendInputBar` 内替换 `clearInputBar();` 一行）**

```js
            // 原：clearInputBar();  // 清空内容但保持展开
            // 改：按设置决定收起还是保持展开
            if (inputBarCloseAfterSend) closeInputBar();   // 清空并收起（closeInputBar 默认 clear=true）
            else clearInputBar();                          // 清空保持展开
```

- [ ] **Step 6: 手动验证完整行为**

1. 默认：输入框右侧按钮文字「换行」，点它插入换行；按 Enter 发送；发送后保持展开。
2. 设置「右侧按钮动作」=发送 → 按钮文字变「发送」，点击实际发送。
3. 设置「Enter 键动作」=换行 → 输入框按 Enter 插入换行。
4. 勾选「发送后关闭输入条」→ 发送后输入条收起回到快捷键栏；取消勾选恢复保持展开。
5. 刷新页面 / 重连 → 设置从 config.json 经服务端下发恢复，按钮文字与行为正确。

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: 输入条行为按设置接线（按钮分发+动态文字+Enter分支+发送后收起）"
```

---

### Task 8: 文档更新（AGENTS.md）+ 最终验证

**Files:**
- Modify: `AGENTS.md`（note 35 补充三设置项 + 多端同步链路说明）

**Interfaces:**
- Consumes: 全部前述任务
- Produces: 更新后的 AGENTS.md 注意事项

- [ ] **Step 1: 在 AGENTS.md note 35 末尾补充**

在 note 35 现有内容之后追加一段（注意保留原有 `public/index.html` 引用与机制描述）：

```
    - **输入条动作可配置（2026-07-15 引入）**：右侧按钮动作（`inputBarButtonAction`：换行/发送，默认换行）、Enter 键动作（`inputBarEnterAction`：换行/发送，默认发送）、发送后是否关闭输入条（`inputBarCloseAfterSend`：布尔，默认 false 保持展开）三个行为均可在设置弹窗随时调整并**多端同步**。完整链路同 `swipe_*`：`config.json` 字段 → `loadConfig` 默认值+校验 → 连接时下发 → ws handler 校验+`saveConfig`+`broadcast` → 前端 `apply*` 只 `wsSend`（服务端权威）→ 接收侧更新变量+日志。右侧按钮 `onclick` 改分发函数 `inputBarRightButton()`（按 `inputBarButtonAction` 调 `sendInputBar`/`insertNewline`），按钮文字由 `applyInputBarButtonLabel()` 随设置切换「换行」/「发送」；Enter 键按 `inputBarEnterAction` 分支；`sendInputBar()` 末尾按 `inputBarCloseAfterSend` 决定 `closeInputBar()`（收起）或 `clearInputBar()`（保持）。无 Shift+Enter 兜底（严禁过度设计）。设置弹窗控件：两个 `<select>`（应用按钮 + `fbBtn` 反馈）+ 一个勾选框（即时应用 + `flashHint`）。
```

- [ ] **Step 2: 最终手动验证（需用户 `npm run restart` 后）**

1. 后端：`npm run restart` 重启（AI 不私自重启，仅通知）。
2. 打开 `config.json` 确认出现 `inputBarButtonAction`/`inputBarEnterAction`/`inputBarCloseAfterSend` 三字段。
3. 浏览器连两个窗口，验证多端同步（Task 6 Step 2）与完整行为（Task 7 Step 6）。
4. 验证非法配置容错：`config.json` 手改 `inputBarButtonAction: "foo"` → 重启后回落默认 `newline`（loadConfig 校验生效）。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 补充输入条三动作可配置设置项说明"
```

---

## Self-Review

**1. Spec 覆盖：**
- §2 三配置项 → Task 1（默认+校验）、Task 2（下发）、Task 3（handler）、Task 4（前端变量+控件）、Task 5（apply）、Task 6（接收）、Task 7（接线）。✓
- §3.1 默认对象 → Task 1 Step 1。✓
- §3.2 校验 → Task 1 Step 2。✓
- §3.3 连接下发 → Task 2。✓
- §3.4 ws handler → Task 3。✓
- §4.1 顶层变量 → Task 4 Step 1。✓
- §4.2 弹窗 HTML → Task 4 Step 2。✓
- §4.3 值同步 → Task 4 Step 3。✓
- §4.4 apply 函数 → Task 5。✓
- §4.5 接收侧 → Task 6。✓
- §4.6 行为接线（按钮分发+动态文字+Enter 分支+发送后收起）→ Task 7。✓
- §4.7 占位符可选 → 未列入任务（标记为可选小优化，YAGNI，留待用户要求再做）。✓
- §7 验收标准 → Task 7 Step 6 + Task 8 Step 2。✓
- §8 文档更新 → Task 8。✓

**2. 占位符扫描：** 无 TBD/TODO/"类似 Task N"/"适当处理"。所有代码步骤均含完整代码。✓

**3. 类型/命名一致性：**
- 消息类型 `input_bar_button_action` / `input_bar_enter_action` / `input_bar_close_after_send` 在 spec、Task 2/3/5/6 完全一致。✓
- 控件 id `settingsInputBarButtonActionInput` / `settingsInputBarEnterActionInput` / `settingsInputBarCloseAfterSendInput` / `hint-inputBarCloseAfterSend` 在 Task 4/5 一致。✓
- 函数 `inputBarRightButton` / `applyInputBarButtonLabel` 在 Task 6（调用）与 Task 7（定义）一致。✓
- 变量 `inputBarButtonAction` / `inputBarEnterAction` / `inputBarCloseAfterSend` 全计划一致。✓
