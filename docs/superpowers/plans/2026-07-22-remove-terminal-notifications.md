# 删除 RemoteCMD 终端自带通知子系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底删除 RemoteCMD 内置的四类通知（声音 / Toast / 系统通知 / 飞书推送）及其唯一触发器（doneToken 完成标记），并保留可恢复记录。

**Architecture:** 纯删除任务，无新增逻辑。代码侧（server.js、public/index.html、tests、AGENTS.md、恢复文档）全部集中到**单个 git 提交**，靠 `git revert` 还原；配置侧（config.json，被 gitignore 排除）先 `cp` 为 `config.json.bak` 本地备份再删字段。通用 `showToast` 与 CodeBuddy hooks 飞书通知不动。

**Tech Stack:** Node.js (Express + ws + node-pty)、原生前端（单文件 index.html + styles.css）、git。

## Global Constraints

- **单个 git 提交**：所有代码/文档/测试改动集中在一次提交，`git revert <hash>` 完整还原（与"频繁提交"惯例例外，因 spec 明确要求单提交以便恢复）。`config.json` 与 `config.json.bak` 均被 gitignore，**不进提交**。
- **绝不自行重启服务**：改了 `server.js` 后只通知用户 `npm run restart`，AI 不执行重启命令。
- **通用 `showToast` 必须保留**（复制/删除/报错反馈），只删 `bell` 通知相关的 `showBellToast`/`fireOsNotification`/`playBeep`。
- **CodeBuddy hooks 飞书通知、共享 `pythonProjectFeiShuHooks` 脚本、ntfy（代码已不存在）一律不动。**
- 删除后不得残留任何对 `bellSoundEnabled`/`bellToastEnabled`/`bellOsEnabled`/`bellBeepDurationMs`/`feishu*`/`doneToken` 的引用（grep 校验）。

---

### Task 1: 备份 config.json

**Files:**
- Backup: `config.json` → `config.json.bak`

- [ ] **Step 1: 复制本地备份**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
cp config.json config.json.bak
ls -la config.json.bak
```

Expected: 输出 `config.json.bak` 文件信息（含真实飞书凭证，作为恢复安全网，不会被 git 提交）。

---

### Task 2: server.js — 删除通知配置默认值与兜底校验

**Files:**
- Modify: `server.js:26-35`（默认值块）、`server.js:72-81`（兜底校验块）

**Interfaces:** 无（纯删除）。

- [ ] **Step 1: 删除默认值块中的通知字段**

`server.js` 默认值对象内，删除以下 7 行（位于 `showScrollButtons: true,` 与 `inputBarButtonAction:` 之间）：

```javascript
            doneToken: 'REMOTECMD_DONE', // 完成标记：PTY 输出流精确匹配该串才触发通知（替换 BEL）
            bellSoundEnabled: true,
            bellToastEnabled: true,
            bellOsEnabled: true, // 系统通知（OS 弹窗）开关
            bellBeepDurationMs: 300,

            feishuAppId: '', // 飞书自建应用 app_id（完成标记命中后通过应用 API 发消息）
            feishuAppSecret: '', // 飞书自建应用 app_secret（仅服务端使用，换 tenant_access_token）
            feishuReceiveId: '', // 接收消息的 ID：邮箱/群 chat_id/open_id/user_id（依 receive_type）
            feishuReceiveType: 'email', // 接收 ID 类型：email / chat_id / open_id / user_id
```

保留 `showScrollButtons: true,` 和 `inputBarButtonAction: 'newline',` 不变。

- [ ] **Step 2: 删除兜底校验块中的通知字段**

删除 `if (typeof cfg.showScrollButtons !== 'boolean') cfg.showScrollButtons = true;` 之后的 9 行：

```javascript
    if (typeof cfg.doneToken !== 'string') cfg.doneToken = 'REMOTECMD_DONE';
    if (typeof cfg.bellSoundEnabled !== 'boolean') cfg.bellSoundEnabled = true;
    if (typeof cfg.bellToastEnabled !== 'boolean') cfg.bellToastEnabled = true;
    if (typeof cfg.bellOsEnabled !== 'boolean') cfg.bellOsEnabled = true;
    if (typeof cfg.bellBeepDurationMs !== 'number' || cfg.bellBeepDurationMs < 50 || cfg.bellBeepDurationMs > 2000) cfg.bellBeepDurationMs = 300;

        if (typeof cfg.feishuAppId !== 'string') cfg.feishuAppId = '';
        if (typeof cfg.feishuAppSecret !== 'string') cfg.feishuAppSecret = '';
        if (typeof cfg.feishuReceiveId !== 'string') cfg.feishuReceiveId = '';
        if (typeof cfg.feishuReceiveType !== 'string' || ['email','chat_id','open_id','user_id'].indexOf(cfg.feishuReceiveType) === -1) cfg.feishuReceiveType = 'email';
```

保留其后 `if (cfg.inputBarButtonAction !== 'newline' ...)` 不变。

- [ ] **Step 3: 校验无残留引用**

Run: `grep -n "doneToken\|bellSoundEnabled\|bellToastEnabled\|bellOsEnabled\|bellBeepDurationMs\|feishuAppId\|feishuAppSecret\|feishuReceiveId\|feishuReceiveType" server.js`
Expected: 仍命中（ Task 3–6 才删完），本步仅确认本次删除生效、无语法截断。

---

### Task 3: server.js — 删除飞书后端函数

**Files:**
- Modify: `server.js:175-213`（`// 飞书自建应用` 注释到 `sendFeishuMessage` 结束，含其后一个空行）

**Interfaces:** 无（纯删除）。

- [ ] **Step 1: 删除飞书后端整段**

删除从 `// 飞书自建应用：缓存 tenant_access_token...` 到 `sendFeishuMessage` 函数结束 `}` 及之后空行的全部内容（即原 L175–214）：

```javascript
// 飞书自建应用：缓存 tenant_access_token（提前 60s 刷新，避免每次发消息都换 token）
let _feishuToken = null;
let _feishuTokenExpire = 0;
// 凭证变更后必须使缓存失效，否则会拿着旧 app 的 token 静默失败
function invalidateFeishuToken() {
    _feishuToken = null;
    _feishuTokenExpire = 0;
}
function getFeishuTenantToken() {
    const now = Date.now();
    if (_feishuToken && now < _feishuTokenExpire) return Promise.resolve(_feishuToken);
    return fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret })
    }).then(r => r.json()).then(j => {
        if (j.code !== 0) throw new Error('feishu token failed: ' + j.code + ' ' + j.msg);
        _feishuToken = j.tenant_access_token;
        _feishuTokenExpire = now + ((j.expire || 7200) - 60) * 1000;
        return _feishuToken;
    });
}
// 通过飞书自建应用 API 发送一条文本消息（fire-and-forget，调用方自行 .catch）
function sendFeishuMessage(text) {
    return getFeishuTenantToken().then(token => {
        const body = {
            receive_id: config.feishuReceiveId,
            msg_type: 'text',
            content: JSON.stringify({ text: text })
        };
        return fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=' + encodeURIComponent(config.feishuReceiveType), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify(body)
        }).then(r => r.json()).then(j => {
            if (j.code !== 0) throw new Error('feishu send failed: ' + j.code + ' ' + j.msg);
        });
    });
}
```

注意：前后相邻代码（`process.on('unhandledRejection'...)` 与后续非飞书代码）保持不变，仅删掉中间这一整段。

---

### Task 4: server.js — 删除 onData 中的 doneToken 扫描

**Files:**
- Modify: `server.js:352-373`（完成标记扫描注释 + `if (tok)` 块，含飞书推送出口）

**Interfaces:** 保留 `broadcast({ type: 'data', id: newId, data: d });`（位于扫描块之后）。

- [ ] **Step 1: 删除完成标记扫描块**

在 `ptyProcess.onData((d) => {` 回调内，删除从 `// === 完成标记扫描...` 到 `}`（结束 `else` 分支）的整段：

```javascript
        // === 完成标记扫描：精确匹配可配置标记串（默认 REMOTECMD_DONE）即触发通知（替换 BEL 去抖）===
        // 标记跨 chunk 到达时用 doneCarry 拼接尾部；命中后只消费到标记处、保留其后未读内容。
        // 标记原样随 data 透传（可见、可验证），不滤除。
        const tok = config.doneToken || '';
        if (tok) {
            const buf = (sessions[newId].doneCarry || '') + d;
            const idx = buf.indexOf(tok);
            if (idx >= 0) {
                sessions[newId].doneCarry = buf.slice(idx + tok.length);
                broadcast({ type: 'bell', id: newId });
                // 飞书自建应用推送出口：完成标记命中后通过应用 API 发消息（fire-and-forget）
                if (config.feishuAppId && config.feishuAppSecret && config.feishuReceiveId) {
                    const name = sessions[newId] ? sessions[newId].name : '终端';
                    const feishuText = '终端「' + name + '」任务完成';
                    sendFeishuMessage(feishuText).catch(e => console.error('[feishu] 推送失败:', e.message));
                }

            } else {
                // 未命中：只保留末尾最多 tok.length 字节，避免缓冲无限增长
                sessions[newId].doneCarry = buf.length > tok.length ? buf.slice(buf.length - tok.length) : buf;
            }
        }
```

删除后，`// data 消息：原样透传...` 注释与 `broadcast({ type: 'data', id: newId, data: d });` 应紧随 headless 同步代码之后，结构完整。

---

### Task 5: server.js — 删除连接时的通知下发

**Files:**
- Modify: `server.js:419-428`（连接建立时 ws.send 的 done_token / bell_* / feishu_* / bell_beep_duration_ms）

**Interfaces:** 保留 `ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));` 及前后其他下发。

- [ ] **Step 1: 删除通知相关下发**

删除 `ws.send(JSON.stringify({ type: 'done_token', data: config.doneToken }));` 到 `ws.send(JSON.stringify({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs }));` 的整段 10 行：

```javascript
    ws.send(JSON.stringify({ type: 'done_token', data: config.doneToken }));
    ws.send(JSON.stringify({ type: 'bell_sound_enabled', data: config.bellSoundEnabled }));
    ws.send(JSON.stringify({ type: 'bell_toast_enabled', data: config.bellToastEnabled }));
    ws.send(JSON.stringify({ type: 'bell_os_enabled', data: config.bellOsEnabled }));

        ws.send(JSON.stringify({ type: 'feishu_app_id', data: config.feishuAppId }));
    ws.send(JSON.stringify({ type: 'feishu_app_secret', data: config.feishuAppSecret }));
    ws.send(JSON.stringify({ type: 'feishu_receive_id', data: config.feishuReceiveId }));
    ws.send(JSON.stringify({ type: 'feishu_receive_type', data: config.feishuReceiveType }));
    ws.send(JSON.stringify({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs }));
```

注意保留该段前后的 `screen_history_lines` 下发与 `recent_paths` 下发不变。

---

### Task 6: server.js — 删除 ws 消息处理分支

**Files:**
- Modify: `server.js:580-637`（ws.on('message') 内的 done_token / bell_* / feishu_* / bell_beep_duration_ms 分支）

**Interfaces:** 保留 `else if (type === 'rename' && sessions[id])` 及之后所有分支。

- [ ] **Step 1: 删除通知处理分支**

删除从 `else if (type === 'done_token') {` 到 `bell_beep_duration_ms` 分支结束 `}` 的整段（原 L580–637），即：

```javascript
        else if (type === 'done_token') {
            if (typeof data !== 'string') return;
            config.doneToken = data;
            broadcast({ type: 'done_token', data: config.doneToken });
            saveConfig(config);
        }
        else if (type === 'bell_sound_enabled') {
            if (typeof data !== 'boolean') return;
            config.bellSoundEnabled = data;
            broadcast({ type: 'bell_sound_enabled', data: config.bellSoundEnabled });
            saveConfig(config);
        }
        else if (type === 'bell_toast_enabled') {
            if (typeof data !== 'boolean') return;
            config.bellToastEnabled = data;
            broadcast({ type: 'bell_toast_enabled', data: config.bellToastEnabled });
            saveConfig(config);
        }
        else if (type === 'bell_os_enabled') {
            if (typeof data !== 'boolean') return;
            config.bellOsEnabled = data;
            broadcast({ type: 'bell_os_enabled', data: config.bellOsEnabled });
            saveConfig(config);
        }

        else if (type === 'feishu_app_id') {
            if (typeof data !== 'string') return;
            config.feishuAppId = data;
            invalidateFeishuToken();
            broadcast({ type: 'feishu_app_id', data: config.feishuAppId });
            saveConfig(config);
        }
        else if (type === 'feishu_app_secret') {
            if (typeof data !== 'string') return;
            config.feishuAppSecret = data;
            broadcast({ type: 'feishu_app_secret', data: config.feishuAppSecret });
            invalidateFeishuToken();
            saveConfig(config);
        }
        else if (type === 'feishu_receive_id') {
            if (typeof data !== 'string') return;
            config.feishuReceiveId = data;
            broadcast({ type: 'feishu_receive_id', data: config.feishuReceiveId });
            saveConfig(config);
        }
        else if (type === 'feishu_receive_type') {
            if (typeof data !== 'string' || ['email','chat_id','open_id','user_id'].indexOf(data) === -1) return;
            config.feishuReceiveType = data;
            broadcast({ type: 'feishu_receive_type', data: config.feishuReceiveType });
            saveConfig(config);
        }
        else if (type === 'bell_beep_duration_ms') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 50 || v > 2000) return;
            config.bellBeepDurationMs = v;
            broadcast({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs });
            saveConfig(config);
        }
```

删除后，上一分支 `else if (type === 'max_frontend_logs')` 与下一分支 `else if (type === 'rename' && sessions[id])` 直接衔接，链完整。

- [ ] **Step 2: 校验 server.js 无残留且语法正确**

Run: `node --check server.js`
Expected: 无输出（语法通过）。
Run: `grep -n "feishu\|bell\|doneToken\|done_token" server.js`
Expected: 无输出（通知子系统已从 server.js 彻底移除）。

---

### Task 7: index.html — 删除状态变量 / 设置 UI / 回填

**Files:**
- Modify: `public/index.html` 三处：`let bellSoundEnabled...` 状态变量段、`通知`+`飞书通知`设置分组、`document.getElementById('settingsBellSoundEnabledInput')...` 回填段。

**Interfaces:** 保留 `showToast`、`fbBtn`、`flashHint` 等通用函数与后续其他设置项。

- [ ] **Step 1: 删除状态变量段**

删除 `// === BEL 通知设置 ===` 注释到 `let bellBeepDurationMs = 300;` 的整段（原 L81–91）：

```javascript
        // === BEL 通知设置 ===
        let bellSoundEnabled = true; // 蜂鸣开关
        let bellToastEnabled = true; // Toast 开关
        let bellOsEnabled = true;    // 系统通知（OS 弹窗）开关

        let feishuAppId = '';     // 飞书自建应用 app_id
        let feishuAppSecret = ''; // 飞书自建应用 app_secret（仅服务端用）
        let feishuReceiveId = ''; // 接收 ID：邮箱/chat_id/open_id/user_id
        let feishuReceiveType = 'email'; // 接收 ID 类型
        let doneToken = 'REMOTECMD_DONE'; // completion marker (replaces BEL)
        let bellBeepDurationMs = 300; // 蜂鸣单声时长（ms）
```

（其后的 `// 保留 hotkeyList...` 注释与 `const editBtnEl` 保留。）

- [ ] **Step 2: 删除设置弹窗中的「通知」与「飞书通知」分组**

删除从 `html += '<div class="modal-group-title">通知</div>';`（原 L276）到 `html += '</div>'; // end feishu modal-group`（原 L335）的整段，即「通知」分组（含声音/Toast/系统通知/done token/蜂鸣时长）与「飞书通知」分组全部。

- [ ] **Step 3: 删除回填段**

删除 `populateSettings` 内以下 10 行（原 L369–378）：

```javascript
            document.getElementById('settingsBellSoundEnabledInput').checked = bellSoundEnabled;
            document.getElementById('settingsBellToastEnabledInput').checked = bellToastEnabled;
            document.getElementById('settingsBellOsEnabledInput').checked = bellOsEnabled;

            document.getElementById('settingsFeishuAppIdInput').value = feishuAppId;
            document.getElementById('settingsFeishuAppSecretInput').value = feishuAppSecret;
            document.getElementById('settingsFeishuReceiveIdInput').value = feishuReceiveId;
            document.getElementById('settingsFeishuReceiveTypeInput').value = feishuReceiveType;
            document.getElementById('settingsDoneTokenInput').value = doneToken;
            document.getElementById('settingsBellBeepDurationInput').value = bellBeepDurationMs;
```

（其后的 `}` 与 `function closeSettingsModal()` 保留。）

- [ ] **Step 4: 校验**

Run: `grep -n "settingsBellSoundEnabledInput\|settingsFeishuAppIdInput\|settingsDoneTokenInput\|modal-group-title\">通知\|飞书通知" public/index.html`
Expected: 无输出。

---

### Task 8: index.html — 删除函数 / apply / ws 处理分支

**Files:**
- Modify: `public/index.html` 三处：`showBellToast`+`fireOsNotification`+`playBeep` 函数段、各 `applySettings*` 函数段、ws 消息处理分支。

**Interfaces:** 保留 `fbBtn`（被其他设置项广泛使用，不可删）。

- [ ] **Step 1: 删除通知函数段**

删除从 `function showBellToast(id) {`（原 L420）到 `playBeep` 函数结束 `}` 的整段（L420–464），包含 `showBellToast`、`fireOsNotification`、`let audioCtx = null;` + `playBeep`。其后 `function fbBtn(id, ok) {`（L466）保留。

- [ ] **Step 2: 删除 apply 函数段**

删除以下 5 个函数（原 L586–639）：`applySettingsBellSoundEnabled`、`applySettingsBellToastEnabled`、`applySettingsBellOsEnabled`、`applySettingsDoneToken`、`applySettingsFeishu`、`applySettingsBellBeepDuration`。每个函数从 `function applySettingsXxx() {` 到其结束 `}` 整段删除。其后 `// === 大/小尺寸槽位应用...` 注释（L641）保留。

- [ ] **Step 3: 删除 ws 消息处理中的通知分支**

在 ws `onmessage` 的 `if/else if` 链中删除以下分支（保留链完整，仅去掉这些 `else if` 分支）：
- `} else if (msg.type === 'bell') {` 块（原 L862–865，含 `showBellToast`/`playBeep`/`fireOsNotification` 三调用）
- `} else if (msg.type === 'done_token') {`（原 L904–906）
- `} else if (msg.type === 'bell_sound_enabled') {`（原 L907–909）
- `} else if (msg.type === 'bell_toast_enabled') {`（原 L910–912）
- `} else if (msg.type === 'bell_os_enabled') {`（原 L913–915）
- `} else if (msg.type === 'feishu_app_id') {`（原 L916–918）
- `} else if (msg.type === 'feishu_app_secret') {`（原 L919–921）
- `} else if (msg.type === 'feishu_receive_id') {`（原 L922–924）
- `} else if (msg.type === 'feishu_receive_type') {`（原 L925–927，注意其 `} else if` 缩进）
- `} else if (msg.type === 'bell_beep_duration_ms') {`（原 L932–934）

（保留 `data` / `size_slots` / `current_size` / `hotkeys` / `scroll_interval_*` / `max_frontend_logs` / `screen_history_lines` / `server_log` / `swipe_*` 等分支。）

- [ ] **Step 4: 校验**

Run: `grep -n "bell\|feishu\|doneToken\|done_token\|playBeep\|showBellToast\|fireOsNotification" public/index.html`
Expected: 无输出（仅剩样式/注释中无上述词；如有样式残留确认非通知专用再处理）。

---

### Task 9: 删除通知冒烟测试

**Files:**
- Delete: `tests/feishu-settings-smoke.mjs`
- Delete: `tests/os-notify-smoke.mjs`

- [ ] **Step 1: 删除两个测试文件**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
rm tests/feishu-settings-smoke.mjs tests/os-notify-smoke.mjs
ls tests/
```

Expected: 列出剩余测试文件，不再含 `feishu-settings-smoke.mjs` 与 `os-notify-smoke.mjs`。

---

### Task 10: 编辑 config.json 删除通知字段

**Files:**
- Modify: `config.json`（基于 Task 1 的 `config.json.bak` 备份）

- [ ] **Step 1: 删除通知相关键**

用编辑器打开 `config.json`，删除以下键（保留其余全部字段，尤其是 `recentPaths`、各 sizeSlots 等）：
- `doneToken`
- `bellSoundEnabled`
- `bellToastEnabled`
- `bellBeepDurationMs`
- `bellOsEnabled`
- `feishuAppId`
- `feishuAppSecret`
- `feishuReceiveId`
- `feishuReceiveType`

删除后 JSON 必须为合法格式（无尾随逗号）。

- [ ] **Step 2: 校验 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('OK')"`
Expected: 输出 `OK`。

---

### Task 11: AGENTS.md 精简通知文档

**Files:**
- Modify: `AGENTS.md`（配置表 L46、WS 协议表 L68–95、BEL/doneToken 协议段 L311–349）

- [ ] **Step 1: 配置表去飞书字段**

L46 去掉 `feishuAppId/feishuAppSecret/feishuReceiveId/feishuReceiveType（飞书推送）` 说明。

- [ ] **Step 2: WS 协议表去 feishu_* 行**

删除 L68–71（`feishu_app_id`/`feishu_app_secret`/`feishu_receive_id`/`feishu_receive_type` 四行）与 L92–95（对应服务端接收行）。

- [ ] **Step 3: BEL/doneToken 协议段改为一次性说明**

将 L311–349 中关于 BEL 协议、`doneToken` 语义、后端透传、设置即时生效等段落，替换为一句：

```
- **通知子系统已于 2026-07-22 移除**：原 BEL/Toast/系统通知/飞书推送/doneToken 触发链全部删除，改由用户侧的 CodeBuddy hooks 飞书通知承担。如需恢复，见 `docs/superpowers/RECOVERY-remove-notifications.md`。
```

（保留该段中与非通知相关的其他说明不动。）

- [ ] **Step 4: 按规矩通知用户**

AGENTS.md 改动后，在交付说明中告知用户"已更新 AGENTS.md 通知相关文档"。

---

### Task 12: 新增恢复文档

**Files:**
- Create: `docs/superpowers/RECOVERY-remove-notifications.md`

- [ ] **Step 1: 写入恢复文档**

```markdown
# 恢复指南：终端通知子系统（2026-07-22 移除）

本目录原内置四类通知（声音 / Toast / 系统通知 / 飞书推送）及其 doneToken 完成标记触发器，
于 2026-07-22 经 commit <HASH> 整体删除（因用户已改用 CodeBuddy hooks 飞书通知）。

## 删除清单
- server.js：通知配置默认值、兜底校验、飞书后端（getFeishuTenantToken/sendFeishuMessage）、
  onData 内 doneToken 扫描 + bell 广播、连接下发、ws 消息处理分支。
- public/index.html：状态变量、设置 UI（通知/飞书分组）、函数（showBellToast/fireOsNotification/playBeep）、
  apply 函数、ws 处理分支。
- tests/：feishu-settings-smoke.mjs、os-notify-smoke.mjs。
- config.json：doneToken / bell* / feishu* 字段（保留其余）。
- AGENTS.md：精简通知文档。

## 恢复步骤
1. 代码：在仓库根执行 `git revert <HASH>` 即可完整还原 server.js / index.html / tests / AGENTS.md。
2. 配置：config.json 不在 git（被 .gitignore 排除），需从本地备份还原：
   `cp config.json.bak config.json`
   （config.json.bak 由删除时生成，含原飞书凭证；如已丢失，按原格式重新填写。）

## 注意
- 恢复代码后仍需 `npm run restart` 使 server.js 生效。
- 通用 showToast（复制/删除/报错反馈）未受影响，无需恢复。
```

> 实现时把 `<HASH>` 替换为实际提交哈希（Task 13 提交后回填）。

---

### Task 13: 单 git 提交

**Files:**
- 提交：`server.js`、`public/index.html`、`tests/`（删除两个文件）、`AGENTS.md`、`docs/superpowers/RECOVERY-remove-notifications.md`、`docs/superpowers/specs/2026-07-22-remove-terminal-notifications-design.md`（已在 design 阶段提交，本次若未含则一并 add）

**Interfaces:** 本提交即恢复所需的 `<HASH>`。

- [ ] **Step 1: 暂存并提交（不含 config.json / config.json.bak，二者被 gitignore）**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
git add server.js public/index.html tests/ AGENTS.md docs/superpowers/RECOVERY-remove-notifications.md
git commit -m "refactor: 删除终端内置通知子系统（声音/Toast/系统通知/飞书/doneToken）

用户已改用 CodeBuddy hooks 飞书通知，内置通知冗余。
恢复方式：git revert <本提交> + cp config.json.bak config.json（见 RECOVERY 文档）。"
git log --oneline -1
```

Expected: 输出新提交哈希。

- [ ] **Step 2: 回填恢复文档中的 <HASH>**

用编辑器将 `docs/superpowers/RECOVERY-remove-notifications.md` 中的 `<HASH>` 替换为上一步实际哈希，然后：

```bash
git add docs/superpowers/RECOVERY-remove-notifications.md
git commit --amend --no-edit
```

（如不想 amend，也可单独补一个 commit。）

---

### Task 14: 全局校验

- [ ] **Step 1: 全仓无通知符号残留**

Run:
```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
grep -rn "feishu\|bell_\|bellSound\|bellToast\|bellOs\|bellBeep\|doneToken\|done_token\|playBeep\|showBellToast\|fireOsNotification" server.js public/index.html tests/ AGENTS.md
```
Expected: 无输出（通知子系统彻底移除；config.json 不在范围内，其残留由 .bak 管理）。

- [ ] **Step 2: 语法校验**

Run: `node --check server.js`
Expected: 无输出。

- [ ] **Step 3: 通知用户重启**

告知用户：代码已删除并单提交完成，请运行 `npm run restart` 使 server.js 生效；重启后在浏览器打开设置弹窗，确认不再有「通知」「飞书通知」分组，且终端输出 `REMOTECMD_DONE` 不再触发任何通知、无 JS 报错。

---

## Self-Review 记录

- **Spec 覆盖**：设计文档的 6 个删除项（server.js / index.html / tests / config.json / AGENTS.md / 恢复文档）均有对应 Task 1–13 覆盖；保留项（showToast、hooks、ntfy）在 Global Constraints 与恢复文档中声明不动。
- **占位符扫描**：无 TBD/TODO；每个删除步骤均给出精确文本或唯一锚点；恢复文档 `<HASH>` 为已知需回填项（已在 Task 13 Step 2 处理）。
- **类型/命名一致性**：删去的 `feishu*`、`bell*`、`doneToken` 在所有文件中命名一致；`fbBtn` 经核查被其他设置项广泛使用，已明确保留不删；`audioCtx`/`playBeep` 仅通知使用，整段删除。
- **单提交约束**：已显式说明与"频繁提交"惯例的偏离理由（spec 要求单提交以便 `git revert`）。
