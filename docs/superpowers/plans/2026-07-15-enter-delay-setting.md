# 回车停顿 enterDelayMs 多端同步设置 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把输入条「回车停顿」从硬编码 `ENTER_DELAY=300ms` 改为可配置、多端同步的设置项 `enterDelayMs`（默认 300，范围 50–3000，step 50）。

**Architecture:** 照搬现有 `swipe_threshold` / `input_bar_*` 的端到端链路：config.json 字段 → server.js `loadConfig` 默认/兜底 + 连接下发 + ws handler（校验 + 广播 + 落盘）→ 前端全局变量 + apply 函数（只 wsSend）+ ws.onmessage 接收侧更新。纯增量，不引入新机制。

**Tech Stack:** Node.js (Express 5 + ws) 后端 `server.js`；前端单文件 `public/index.html`（内联 JS，xterm.js v6）。无打包工具、无测试框架。

## 约束（来自设计文档，逐条抄录，所有任务默认遵守）

- `config.json` 字段名：`enterDelayMs`，默认 `300`
- WS 消息类型：`enter_delay_ms`（C→S 设置 + S→C 广播），snake_case
- 前端全局变量：`let enterDelayMs = 300`
- 合法范围：`50 ≤ v ≤ 3000`，`step 50`；**不允许 0**（最小 50ms）
- 服务端校验：非整数 / 越界 → 拒收（不覆盖、不广播）；前端 apply 校验不通过 → `fbBtn(false)`，不发送
- 服务端权威：`applySettingsEnterDelay()` 只 `wsSend`，本地变量由 `ws.onmessage` 接收侧更新
- `enterDelayMs` 与「影响 list 处理三变量」(sizeSlots/currentSize/clientTailMax) 无关，无需调整 WS 下发顺序
- **禁止 AI 私自重启服务器**：改 `server.js` 后只通知用户执行 `npm run restart`（项目纪律 + AGENTS.md）
- 每次代码改动完成后必须立即 `git commit`；一个独立变更一个 commit；`git add` 指定文件，禁止 `git add -A`

## 文件结构

| 文件 | 改动 | 职责 |
|------|------|------|
| `server.js` | 修改 | `loadConfig` 默认+兜底、连接下发 `enter_delay_ms`、ws handler 校验+广播+落盘 |
| `public/index.html` | 修改 | 全局变量 `enterDelayMs`、`sendInputBar` 改用 `enterDelayMs`、设置弹窗行、`applySettingsEnterDelay`、`openSettingsModal` 同步、`ws.onmessage` 分支 |
| `AGENTS.md` | 修改 | WS 协议表新增 `enter_delay_ms` + 新增注意事项 42 |
| `config.json` | 运行时自动 | 用户首次改设置后由 `saveConfig` 写入 `enterDelayMs`；无 config 时 `loadConfig` 内存默认 300（config.json 被 gitignore，不手动编辑、不提交） |

> 注：项目无测试框架（AGENTS.md 明确）。本计划用「手动验证」替代 TDD——每任务末尾给出基于浏览器的具体验证步骤 + `config.json` 读取 + `grep` 残留检查。

---

### Task 1: server.js — loadConfig 默认值与兜底校验

**Files:**
- Modify: `server.js:11-30`（def 对象）
- Modify: `server.js:66-68`（兜底校验区）

**Interfaces:**
- Consumes: `CONFIG_PATH`、`loadConfig()`（既有）
- Produces: `config.enterDelayMs`（后续 Task 2 的连接下发与 handler 读取此字段）

- [ ] **Step 1: 在 `def` 对象末尾追加默认值**

`server.js` 约 L27-29 当前为：
```js
            inputBarButtonAction: 'newline',
            inputBarEnterAction: 'send',
            inputBarCloseAfterSend: false
```
改为（在 `inputBarCloseAfterSend` 行后加一行）：
```js
            inputBarButtonAction: 'newline',
            inputBarEnterAction: 'send',
            inputBarCloseAfterSend: false,
            enterDelayMs: 300
```

- [ ] **Step 2: 在兜底校验区末尾追加校验**

`server.js` 约 L66-68 当前为：
```js
    if (cfg.inputBarButtonAction !== 'newline' && cfg.inputBarButtonAction !== 'send') cfg.inputBarButtonAction = 'newline';
    if (cfg.inputBarEnterAction !== 'newline' && cfg.inputBarEnterAction !== 'send') cfg.inputBarEnterAction = 'send';
    if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
```
改为（在其后加一行）：
```js
    if (cfg.inputBarButtonAction !== 'newline' && cfg.inputBarButtonAction !== 'send') cfg.inputBarButtonAction = 'newline';
    if (cfg.inputBarEnterAction !== 'newline' && cfg.inputBarEnterAction !== 'send') cfg.inputBarEnterAction = 'send';
    if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
    if (typeof cfg.enterDelayMs !== 'number' || cfg.enterDelayMs < 50 || cfg.enterDelayMs > 3000) cfg.enterDelayMs = 300;
```

- [ ] **Step 3: 手动验证 loadConfig 默认生效**

确认当前 `config.json` 无 `enterDelayMs` 字段（项目 gitignore，不提交）。重启说明：本步仅改 `loadConfig`，但本任务与 Task 2 同属 `server.js`，合并到 Task 2 末尾重启验证更省事——**先不单独重启**。验证方式：`grep -n "enterDelayMs" server.js` 确认两处已写入。

- [ ] **Step 4: 提交**

```bash
git add server.js
git commit -m "feat: server.js loadConfig 增加 enterDelayMs 默认值与兜底校验"
```

---

### Task 2: server.js — 连接下发 + ws handler

**Files:**
- Modify: `server.js:207-209`（连接时 `ws.send` 下发区）
- Modify: `server.js:326-331`（ws handler，`input_bar_close_after_send` 分支之后）

**Interfaces:**
- Consumes: `config.enterDelayMs`（Task 1 产出）、`broadcast()`、`saveConfig()`（既有）
- Produces: 无其他任务依赖；前端 Task 5 接收 `enter_delay_ms` 消息

- [ ] **Step 1: 连接建立时下发 `enter_delay_ms`**

`server.js` 约 L207-209 当前为：
```js
    ws.send(JSON.stringify({ type: 'input_bar_button_action', data: config.inputBarButtonAction }));
    ws.send(JSON.stringify({ type: 'input_bar_enter_action', data: config.inputBarEnterAction }));
    ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));
```
改为（在其后加一行）：
```js
    ws.send(JSON.stringify({ type: 'input_bar_button_action', data: config.inputBarButtonAction }));
    ws.send(JSON.stringify({ type: 'input_bar_enter_action', data: config.inputBarEnterAction }));
    ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));
    ws.send(JSON.stringify({ type: 'enter_delay_ms', data: config.enterDelayMs }));
```

- [ ] **Step 2: 新增 `enter_delay_ms` handler**

`server.js` 约 L326-331 当前为：
```js
        else if (type === 'input_bar_close_after_send') {
            if (typeof data !== 'boolean') return;
            config.inputBarCloseAfterSend = data;
            broadcast({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend });
            saveConfig(config);
        }
```
改为（在其后追加分支）：
```js
        else if (type === 'input_bar_close_after_send') {
            if (typeof data !== 'boolean') return;
            config.inputBarCloseAfterSend = data;
            broadcast({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend });
            saveConfig(config);
        }
        else if (type === 'enter_delay_ms') {
            if (typeof data !== 'number' || data < 50 || data > 3000) return;
            config.enterDelayMs = data;
            broadcast({ type: 'enter_delay_ms', data: config.enterDelayMs });
            saveConfig(config);
        }
```

- [ ] **Step 3: 手动验证（重启由用户在 Task 6 统一执行，本步先静态核查）**

`grep -n "enter_delay_ms" server.js` 确认下发与 handler 两处均存在，且 handler 校验为 `data < 50 || data > 3000`。

- [ ] **Step 4: 提交**

```bash
git add server.js
git commit -m "feat: server.js 下发并接收 enter_delay_ms 设置(校验+广播+落盘)"
```

---

### Task 3: index.html — 全局变量 + sendInputBar 改用 enterDelayMs + 删除 ENTER_DELAY 常量

**Files:**
- Modify: `public/index.html:82-84`（inputBar 全局变量区）
- Modify: `public/index.html:1337-1338`（ENTER_DELAY 常量）
- Modify: `public/index.html:1372`（sendInputBar 内 sleep 调用）

**Interfaces:**
- Consumes: 无（独立）
- Produces: 全局 `let enterDelayMs`（Task 4 的 apply/openSettingsModal、Task 5 的 ws.onmessage 共享此变量）；`sendInputBar()` 行为变更（停顿=enterDelayMs）

- [ ] **Step 1: 新增全局变量**

`public/index.html` 约 L82-84 当前为：
```js
        let inputBarButtonAction = 'newline';
        let inputBarEnterAction = 'send';
        let inputBarCloseAfterSend = false;
```
改为（在其后加一行）：
```js
        let inputBarButtonAction = 'newline';
        let inputBarEnterAction = 'send';
        let inputBarCloseAfterSend = false;
        let enterDelayMs = 300;   // 输入条回车停顿(ms)，设置可改、多端同步
```

- [ ] **Step 2: 删除 ENTER_DELAY 常量并改写注释**

`public/index.html` 约 L1337-1340 当前为：
```js
        // 正文发完后、单独发回车前的停顿（ms），模拟手动按 Enter 前的手感
        const ENTER_DELAY = 300;

        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```
改为（删除 `const ENTER_DELAY = 300;` 行，更新注释指向设置项）：
```js
        // 输入条回车停顿（ms），模拟手动按 Enter 前的手感；值来自设置项 enterDelayMs（多端同步），非硬编码
        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

- [ ] **Step 3: sendInputBar 内改用 enterDelayMs**

`public/index.html` 约 L1372 当前为：
```js
            await sleep(ENTER_DELAY);                            // 停顿，模拟手动按 Enter 前的手感
```
改为：
```js
            await sleep(enterDelayMs);                          // 停顿，模拟手动按 Enter 前的手感（取自设置项）
```

- [ ] **Step 4: 确认无 ENTER_DELAY 残留引用**

Run: `grep -n "ENTER_DELAY" public/index.html`
Expected: 无输出（0 行）。若有残留，回到对应行修正。

- [ ] **Step 5: 提交**

```bash
git add public/index.html
git commit -m "refactor: 输入条回车停顿改用设置项 enterDelayMs，删除硬编码 ENTER_DELAY"
```

---

### Task 4: index.html — 设置弹窗行 + applySettingsEnterDelay + openSettingsModal 同步

**Files:**
- Modify: `public/index.html:232-234`（设置弹窗「输入条动作」组，close-after-send 行之后）
- Modify: `public/index.html:499-503`（apply 函数区，applySettingsInputBarCloseAfterSend 之后）
- Modify: `public/index.html:341`（openSettingsModal 同步区）

**Interfaces:**
- Consumes: 全局 `enterDelayMs`（Task 3）、`wsSend()`、`fbBtn()`（既有）
- Produces: `applySettingsEnterDelay()`（设置弹窗「应用」按钮 onclick 调用）；DOM 元素 `settingsEnterDelayInput`（Task 5 的 ws.onmessage 不依赖此，仅 openSettingsModal 同步用）

- [ ] **Step 1: 在「输入条动作」组新增一行**

`public/index.html` 约 L232-234 当前为（「发送后关闭输入条」行的结束）：
```js
            // 发送后关闭输入条
            html += '<div class="modal-row">';
            html += '<label class="modal-label"><input type="checkbox" id="settingsInputBarCloseAfterSendInput" onchange="applySettingsInputBarCloseAfterSend()"> 发送后关闭输入条</label>';
            html += '<span id="hint-inputBarCloseAfterSend" class="apply-hint"></span>';
            html += '</div>';
```
改为（在 `</div>` 之后追加「回车停顿」行）：
```js
            // 发送后关闭输入条
            html += '<div class="modal-row">';
            html += '<label class="modal-label"><input type="checkbox" id="settingsInputBarCloseAfterSendInput" onchange="applySettingsInputBarCloseAfterSend()"> 发送后关闭输入条</label>';
            html += '<span id="hint-inputBarCloseAfterSend" class="apply-hint"></span>';
            html += '</div>';

            // 回车停顿 (ms)
            html += '<div class="modal-row">';
            html += '<span class="modal-label">回车停顿 (ms)</span>';
            html += '<input type="number" id="settingsEnterDelayInput" min="50" max="3000" step="50" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-enterDelay" onclick="applySettingsEnterDelay()">应用</button>';
            html += '</div>';
```

- [ ] **Step 2: 新增 applySettingsEnterDelay**

`public/index.html` 约 L499-503 当前为（applySettingsInputBarCloseAfterSend 结束）：
```js
        function applySettingsInputBarCloseAfterSend() {
            const v = document.getElementById('settingsInputBarCloseAfterSendInput').checked;
            wsSend({ type: 'input_bar_close_after_send', data: v });
            flashHint('hint-inputBarCloseAfterSend');
        }
```
改为（在其后追加函数）：
```js
        function applySettingsInputBarCloseAfterSend() {
            const v = document.getElementById('settingsInputBarCloseAfterSendInput').checked;
            wsSend({ type: 'input_bar_close_after_send', data: v });
            flashHint('hint-inputBarCloseAfterSend');
        }
        function applySettingsEnterDelay() {
            const v = parseInt(document.getElementById('settingsEnterDelayInput').value);
            if (Number.isInteger(v) && v >= 50 && v <= 3000) {
                wsSend({ type: 'enter_delay_ms', data: v });
                fbBtn('btn-apply-enterDelay', true);
            } else {
                fbBtn('btn-apply-enterDelay', false);
            }
        }
```

- [ ] **Step 3: openSettingsModal 同步当前值**

`public/index.html` 约 L341 当前为：
```js
            document.getElementById('settingsInputBarCloseAfterSendInput').checked = inputBarCloseAfterSend;
```
改为（在其后加一行）：
```js
            document.getElementById('settingsInputBarCloseAfterSendInput').checked = inputBarCloseAfterSend;
            document.getElementById('settingsEnterDelayInput').value = enterDelayMs;
```

- [ ] **Step 4: 提交（前端改动，刷新网页即可加载，无需重启服务器）**

```bash
git add public/index.html
git commit -m "feat: 设置弹窗新增回车停顿输入项 + applySettingsEnterDelay"
```

---

### Task 5: index.html — ws.onmessage 接收 enter_delay_ms

**Files:**
- Modify: `public/index.html:874-877`（`input_bar_close_after_send` 分支之后）

**Interfaces:**
- Consumes: 全局 `enterDelayMs`（Task 3）、`addFrontendLog()`（既有）
- Produces: 无

- [ ] **Step 1: 新增接收分支**

`public/index.html` 约 L874 起为 `input_bar_close_after_send` 分支，找到其结束 `}`（含可能的 `addFrontendLog`），在其后追加：
```js
                    } else if (msg.type === 'input_bar_close_after_send') {
                        inputBarCloseAfterSend = msg.data;
                        addFrontendLog('发送后关闭输入条同步为 ' + (inputBarCloseAfterSend ? '是' : '否'), 'in');
                    } else if (msg.type === 'enter_delay_ms') {
                        enterDelayMs = msg.data;
                        addFrontendLog('回车停顿同步为 ' + enterDelayMs + ' ms', 'in');
                    }
```
（注：若原 `input_bar_close_after_send` 分支的 `addFrontendLog` 文本表述不同，保持原样，仅在其 `}` 之后插入 `else if (msg.type === 'enter_delay_ms')` 分支，日志文本严格用 `'回车停顿同步为 ' + enterDelayMs + ' ms'`）

- [ ] **Step 2: 提交（前端改动，刷新网页即可加载）**

```bash
git add public/index.html
git commit -m "feat: 前端接收 enter_delay_ms 广播并更新全局变量"
```

---

### Task 6: AGENTS.md 文档 + 验收 + 通知重启

**Files:**
- Modify: `AGENTS.md`（WS 协议表 + 新增注意事项 42）
- 不修改代码；仅文档与验证

**Interfaces:**
- Consumes: 全部前序任务产出
- Produces: 文档更新、验收结论

- [ ] **Step 1: WS 协议表新增两行**

在 AGENTS.md 的「服务端 → 客户端」表中 `input_bar_close_after_send` 附近追加：
```
| `enter_delay_ms` | 回车停顿时长（单位：ms），连接建立时下发 + 设置变更时广播 |
```
在「客户端 → 服务端」表中 `input_bar_close_after_send` 附近追加：
```
| `enter_delay_ms` | 更新回车停顿时长（data，单位：ms，50–3000） |
```

- [ ] **Step 2: 新增注意事项 42**

在 AGENTS.md 注意事项末尾追加（沿用既有编号，当前末条为 41）：
```
42. **回车停顿设置项 enterDelayMs（2026-07-15 引入）**：输入条发送文本时「整段正文发出」与「单独发 \r 回车」之间的停顿，原为硬编码 `ENTER_DELAY=300ms`，现改为可配置、多端同步的设置项 `enterDelayMs`（默认 300，范围 50–3000，step 50）。完整链路：`config.json` 字段 → `loadConfig` 默认(300)+兜底(越界回退 300) → 连接时 `ws.send({type:'enter_delay_ms'})` 下发 → ws handler 校验(非整数/越界拒收)+`saveConfig`+`broadcast` → 前端 `applySettingsEnterDelay()`（只 `wsSend`，服务端权威）→ 接收侧 `enterDelayMs = msg.data` + 前端日志。`sendInputBar()` 内 `await sleep(enterDelayMs)` 取代 `await sleep(ENTER_DELAY)`；`ENTER_DELAY` 常量已删除。Enter 键发送（`inputBarEnterAction==='send'`）与右侧「发送」按钮（`inputBarButtonAction==='send'`）共用 `sendInputBar()`，停顿两者同步受控。设置弹窗「输入条动作」组新增「回车停顿 (ms)」行（number input + 应用按钮，沿用 `swipe_threshold` 模式，非即时应用）。**改了 `server.js` 需 `npm run restart`**（由用户执行，AI 不擅自重启）。
```

- [ ] **Step 3: 静态验收（无需重启即可做）**

Run: `grep -rn "ENTER_DELAY" public/index.html server.js`
Expected: 无输出（确认硬编码常量已完全移除，无残留引用）。

- [ ] **Step 4: 提交文档**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 新增 enter_delay_ms 协议条目与注意事项 42"
```

- [ ] **Step 5: 通知用户重启服务器做端到端验收**

AI **不执行**重启命令。向用户报告：
1. 已改动 `server.js`（Task 1+2）与 `public/index.html`（Task 3/4/5），并 `git commit`。
2. 后端改动需重启才生效，请用户运行 `npm run restart`。
3. 端到端验收清单（用户刷新网页后执行）：
   - 设置弹窗「输入条动作」组出现「回车停顿 (ms)」行，默认显示 `300`，min 50 / max 3000 / step 50。
   - 输入 50–3000 内整数点「应用」→ 按钮变绿、日志出现「回车停顿同步为 X ms」、`config.json` 写入 `enterDelayMs`、其他客户端同步更新。
   - 输入越界/非整数（如 0、4000、abc）点「应用」→ 按钮变红、不发送、不写盘。
   - 设较大值（如 2000）经输入条发送文本，肉眼可感知停顿变长；设 50 则几乎无停顿。
   - 重启服务器后设置从 `config.json` 恢复并下发。

---

## 自审（写完后对照 spec 检查）

1. **Spec 覆盖**：默认值/范围（Task 1 校验 + Task 4 input 属性）✓；config.json 字段（Task 1 def + Task 2 落盘）✓；连接下发（Task 2）✓；handler 校验+广播+落盘（Task 2）✓；前端全局变量（Task 3）✓；sendInputBar 改用（Task 3）✓；删 ENTER_DELAY（Task 3 Step 2/4）✓；设置弹窗行（Task 4）✓；apply（Task 4）✓；openSettingsModal 同步（Task 4）✓；ws.onmessage（Task 5）✓；服务端权威（apply 只 wsSend，接收侧更新）✓；AGENTS.md 更新（Task 6）✓。无遗漏。
2. **占位符扫描**：无 TBD/TODO；每步均含实际代码或具体 grep/命令。✓
3. **类型/命名一致性**：`enterDelayMs`（前端变量）、`enter_delay_ms`（WS 类型）、`config.enterDelayMs`（后端）三者贯穿 Task 1–6 一致；`applySettingsEnterDelay` 在 Task 4 定义、设置弹窗 onclick 引用同一名；DOM id `settingsEnterDelayInput` 在 Task 4 定义、openSettingsModal 与 ws.onmessage 无冲突引用。✓
4. **无擅自重启**：Task 6 Step 5 明确 AI 不重启，仅通知用户。✓
