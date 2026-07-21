# BELL 升级为系统通知（OS Notification）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 BELL 通知链路（PTY 输出 `\x07` → 后端去抖 → `broadcast({type:'bell', id})` → 前端 Toast+蜂鸣）基础上，额外触发浏览器系统级通知（OS Notification），使切走标签页/最小化窗口也能收到提示。

**Architecture:** 后端零改动（BELL 检测与广播已存在）。前端在 `bell` 消息处理分支新增 `fireOsNotification(id)`，并通过 `config.json` 新增独立开关 `bellOsEnabled`（默认开，带 kill switch）控制。沿用现有 `bellToastEnabled`/`bellSoundEnabled` 的同步模式（config.json + WS 广播 + 设置弹窗即时勾选）。

**Tech Stack:** Node.js + Express + ws（后端，不改）；原生浏览器 `Notification` API（前端）；前端单文件 `public/index.html`（原生 JS，无构建、无测试框架）。

## Global Constraints

- 安全上下文：仅 `localhost` / `127.0.0.1`（HTTPS 或 localhost 均为 secure context）下 `Notification` 可用；本期不处理局域网 HTTP 的 HTTPS 问题。
- 新开关默认开：`bellOsEnabled: true`。
- 独立 kill switch：任何打断性功能必须带独立开关（用户既定偏好）。
- 勾选框即时生效，不设「应用」按钮（用户既定偏好）；数值类才用按钮。
- 系统通知必须跟随现有 BELL 去抖（`bellDebounceMs`），不被刷爆。
- 不对 PTY 输出字节流做任何过滤（用户既定偏好）；本期本就不碰后端数据流。

## File Structure

- `server.js` — 仅新增 `bellOsEnabled` 配置字段（默认值 + 兜底 + 连接时广播 + C→S 处理）。BELL 检测逻辑不动。
- `public/index.html` — 新增前端状态变量、设置弹窗勾选框、apply 函数、WS 同步 handler、新增 `fireOsNotification(id)` 函数、在 `bell` 分支调用它。

---

### Task 1: 后端新增 bellOsEnabled 配置字段与同步

**Files:**
- Modify: `server.js` （默认块 ~line 30；兜底 ~line 75；连接广播 ~line 370；C→S 处理 ~line 588 之后）

**Interfaces:**
- Consumes: 现有 `config` 对象与 `broadcast()` / `ws.send()` 机制。
- Produces: 前端将消费 WS 消息 `type: 'bell_os_enabled'`（data 为 boolean）；C→S 接收 `type: 'bell_os_enabled'`（data 为 boolean）。

- [ ] **Step 1: 加默认值**

在 `server.js` `loadConfig()` 的默认对象中，`bellToastEnabled: true,` 之后加一行：

```js
            bellToastEnabled: true,
            bellOsEnabled: true, // 系统通知（OS 弹窗）开关
```

- [ ] **Step 2: 加兜底校验**

在 `loadConfig()` 兜底段（现有 `if (typeof cfg.bellToastEnabled !== 'boolean') cfg.bellToastEnabled = true;` 之后）加：

```js
    if (typeof cfg.bellToastEnabled !== 'boolean') cfg.bellToastEnabled = true;
    if (typeof cfg.bellOsEnabled !== 'boolean') cfg.bellOsEnabled = true;
```

- [ ] **Step 3: 连接时广播**

在 `wss.on('connection')` 内，现有 `ws.send(JSON.stringify({ type: 'bell_toast_enabled', data: config.bellToastEnabled }));` 之后加：

```js
    ws.send(JSON.stringify({ type: 'bell_toast_enabled', data: config.bellToastEnabled }));
    ws.send(JSON.stringify({ type: 'bell_os_enabled', data: config.bellOsEnabled }));
```

- [ ] **Step 4: C→S 处理**

在 `wss.on('connection')` 的 `ws.on('message')` 内，现有 `else if (type === 'bell_toast_enabled') { ... }` 块之后加：

```js
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
```

- [ ] **Step 5: 语法自检 + 提交**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node -c server.js`
Expected: 无输出（语法 OK）

```bash
git add server.js
git commit -m "feat: 新增 bellOsEnabled 配置字段与 WS 同步"
```

---

### Task 2: 前端状态变量 + 设置弹窗勾选框 + apply + 同步 handler

**Files:**
- Modify: `public/index.html` （状态变量 ~line 87；设置弹窗 ~line 301；值回填 ~line 353；apply 函数 ~line 585；WS 同步 ~line 895）

**Interfaces:**
- Consumes: 全局 `wsSend()`、`flashHint()`、`addFrontendLog()`（已存在）。
- Produces: `let bellOsEnabled`（全局 boolean，供 Task 3 的 `fireOsNotification` 读取）；DOM `id="settingsBellOsEnabledInput"` 与 `id="hint-bellOsEnabled"`（供回填与 apply 引用）；全局函数 `applySettingsBellOsEnabled()`（供勾选框 `onchange` 调用）。

- [ ] **Step 1: 加状态变量**

在 `public/index.html` BEL 通知设置段，`let bellToastEnabled = true;` 之后加：

```js
        let bellToastEnabled = true; // Toast 开关
        let bellOsEnabled = true;    // 系统通知（OS 弹窗）开关
```

- [ ] **Step 2: 设置弹窗加勾选框**

在「通知 Toast 开关」的 `modal-row` 块之后（现有 `html += '</div>';` 紧接 Toast 块结束、防抖时长块之前）插入「系统通知」行：

```js
            // 通知 Toast 开关
            html += '<div class="modal-row">';
            html += '<label class="modal-label"><input type="checkbox" id="settingsBellToastEnabledInput" onchange="applySettingsBellToastEnabled()"> 通知 Toast</label>';
            html += '<span id="hint-bellToastEnabled" class="apply-hint"></span>';
            html += '</div>';

            // 系统通知（OS 弹窗）开关
            html += '<div class="modal-row">';
            html += '<label class="modal-label"><input type="checkbox" id="settingsBellOsEnabledInput" onchange="applySettingsBellOsEnabled()"> 系统通知（OS 弹窗）</label>';
            html += '<span id="hint-bellOsEnabled" class="apply-hint"></span>';
            html += '</div>';
```

- [ ] **Step 3: 设置弹窗打开时回填勾选框**

在现有 `document.getElementById('settingsBellToastEnabledInput').checked = bellToastEnabled;` 之后加：

```js
            document.getElementById('settingsBellToastEnabledInput').checked = bellToastEnabled;
            document.getElementById('settingsBellOsEnabledInput').checked = bellOsEnabled;
```

- [ ] **Step 4: 加 apply 函数**

在现有 `applySettingsBellToastEnabled()` 函数之后加：

```js
        function applySettingsBellToastEnabled() {
            const v = document.getElementById('settingsBellToastEnabledInput').checked;
            wsSend({ type: 'bell_toast_enabled', data: v });
            flashHint('hint-bellToastEnabled');
        }

        function applySettingsBellOsEnabled() {
            const v = document.getElementById('settingsBellOsEnabledInput').checked;
            // 首次开启时申请浏览器通知权限
            if (v && 'Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            wsSend({ type: 'bell_os_enabled', data: v });
            flashHint('hint-bellOsEnabled');
        }
```

- [ ] **Step 5: 加 WS 同步 handler**

在现有 `else if (msg.type === 'bell_toast_enabled') { ... }` 块之后加：

```js
                    } else if (msg.type === 'bell_toast_enabled') {
                        bellToastEnabled = msg.data;
                        addFrontendLog('通知 Toast 已' + (bellToastEnabled ? '开启' : '关闭'), 'in');
                    } else if (msg.type === 'bell_os_enabled') {
                        bellOsEnabled = msg.data;
                        addFrontendLog('系统通知已' + (bellOsEnabled ? '开启' : '关闭'), 'in');
                    } else if (msg.type === 'bell_beep_duration_ms') {
```

- [ ] **Step 6: 语法/结构自检 + 提交**

Run: 在浏览器控制台对 `public/index.html` 做轻量检查（见 Task 4），此处先确认无重复 `id`。
Expected: `grep -n "settingsBellOsEnabledInput" public/index.html` 仅出现 2 处（定义 + 回填）。

```bash
git add public/index.html
git commit -m "feat: 前端新增 bellOsEnabled 状态/勾选框/apply/同步"
```

---

### Task 3: fireOsNotification(id) 并接入 bell 分支

**Files:**
- Modify: `public/index.html` （新增函数，紧接 `showBellToast` ~line 400 之后；`bell` 分支 ~line 835）

**Interfaces:**
- Consumes: 全局 `bellOsEnabled`、`sessions`（Map，key=id，value 含 `name`）、`window.focus`。
- Produces: 全局函数 `fireOsNotification(id)`（供 `bell` 分支调用）。

- [ ] **Step 1: 新增 fireOsNotification 函数**

在 `showBellToast(id)` 函数定义之后加：

```js
        function showBellToast(id) {
            const s = sessions.get(id);
            if (!s) return;  // 终端已不存在，不显示
            showToast(`终端通知: ${s.name}`, 'success');
        }

        // 系统级通知（浏览器 Notification → 操作系统弹窗）。
        // 仅当开关开启且浏览器已授权才弹；未授权/不支持则静默跳过（Toast+蜂鸣仍由 bell 分支处理）。
        function fireOsNotification(id) {
            if (!('Notification' in window)) return;            // 浏览器不支持
            if (Notification.permission !== 'granted') return;  // 未授权不弹
            const s = sessions.get(id);
            const name = s ? s.name : '终端';
            try {
                const n = new Notification('终端通知', { body: `${name} 触发提示`, tag: 'remote-cmd-bell' });
                n.onclick = () => { window.focus(); n.close(); };
            } catch (e) {
                // 某些环境构造 Notification 抛错，静默失败不影响 Toast/蜂鸣
            }
        }
```

- [ ] **Step 2: 接入 bell 分支**

将现有：

```js
                    } else if (msg.type === 'bell') {
                        if (bellToastEnabled) showBellToast(msg.id);
                        if (bellSoundEnabled) playBeep();
                    } else if (msg.type === 'size_slots') {
```

改为：

```js
                    } else if (msg.type === 'bell') {
                        if (bellToastEnabled) showBellToast(msg.id);
                        if (bellSoundEnabled) playBeep();
                        if (bellOsEnabled) fireOsNotification(msg.id);
                    } else if (msg.type === 'size_slots') {
```

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: 新增 fireOsNotification 并接入 BELL 分支"
```

---

### Task 4: 验证（手动为主 + Playwright 冒烟）

**Files:**
- Test: `tests/os-notify-smoke.mjs`（新建，Playwright 冒烟，验证开关/函数/权限可被设置，不验证真实 OS 弹窗）

**Interfaces:**
- Consumes: 运行中的服务器（`npm run start`，默认 `http://localhost:65433`）；`playwright`（`npx playwright` 可用）。
- Produces: 验证报告（控制台输出）。

- [ ] **Step 1: 写 Playwright 冒烟脚本**

`tests/os-notify-smoke.mjs`：

```js
import { chromium } from 'playwright';

const base = 'http://localhost:65433';
const browser = await chromium.launch();
// 用 granted 权限的 context，绕过系统授权弹窗，验证前端接线正确
const ctx = await browser.newContext({ permissions: ['notifications'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });

// 1) 函数存在
const hasFn = await page.evaluate(() => typeof window.fireOsNotification === 'function');
console.log('fireOsNotification 存在:', hasFn);

// 2) 权限可被授予（granted context）
const perm = await page.evaluate(() => Notification.permission);
console.log('Notification.permission:', perm);

// 3) 设置勾选框存在并默认勾选
const checked = await page.evaluate(() => {
  const el = document.getElementById('settingsBellOsEnabledInput');
  return el ? el.checked : null;
});
console.log('settingsBellOsEnabledInput 默认勾选:', checked);

// 4) 触发一次并确认不抛错（用 granted 权限，真实弹窗在无头环境可能不可见，但不报错即接线正确）
const triggered = await page.evaluate(() => {
  try { window.fireOsNotification(1); return true; } catch (e) { return String(e); }
});
console.log('fireOsNotification(1) 调用结果:', triggered);

console.log('页面错误:', errors.length ? errors : '无');
await browser.close();
const ok = hasFn && perm === 'granted' && checked === true && triggered === true && errors.length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: 跑冒烟**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node tests/os-notify-smoke.mjs`
Expected: 输出 `SMOKE PASS`（四项全 true、无页面错误）。

- [ ] **Step 3: 手动真机验证 OS 弹窗**

1. `npm run restart`（或确保服务器已带新代码运行）。
2. 浏览器开 `http://localhost:65433`，打开设置弹窗，确认「系统通知（OS 弹窗）」已勾选；若浏览器弹出通知权限请求，点允许。
3. 最小化窗口或切到别的标签页。
4. 在终端运行：`Write-Host \`a` （或 `echo $([char]7)`）。
5. 预期：操作系统弹出通知「终端通知 / <终端名> 触发提示」；切回页面仍有页内 Toast + 蜂鸣。
6. 取消勾选「系统通知」，重复第 4 步：预期仍有 Toast + 蜂鸣，但**不**再弹系统通知。
7. 若浏览器拒绝过通知权限：设置项旁无系统弹窗，Toast+蜂鸣正常——需在浏览器地址栏手动允许。

- [ ] **Step 4: 提交测试脚本**

```bash
git add tests/os-notify-smoke.mjs
git commit -m "test: 添加系统通知冒烟验证脚本"
```

---

## Self-Review 对照 spec

- spec「后端零改动」→ Task 1 仅加配置字段与广播，BELL 检测逻辑未动，符合。
- spec「前端接收侧加 fireOsNotification + 开关」→ Task 2/3 覆盖。
- spec「独立 kill switch 默认开」→ `bellOsEnabled: true` + 勾选框，符合。
- spec「权限申请 + 拒绝提示」→ apply 内 `requestPermission()`；拒绝时静默跳过（spec 允许「不报错」；拒绝提示可由浏览器原生 UI 提供，本期不额外加文字提示，符合非目标「不新增过度设计」）。
- spec「防刷屏沿用去抖」→ 挂在同一条 `bell` 消息，未新增通知逻辑，符合。
- spec「测试」→ Task 4 覆盖手动 + 冒烟。

无占位符、无 TODO。类型一致：`bellOsEnabled`(boolean) 在 server.js/config/ws/前端全局变量/apply/sync 全程一致；`fireOsNotification(id)` 签名在 Task 3 定义、Task 4 调用一致。
