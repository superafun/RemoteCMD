# Size Toggle (大/小尺寸切换) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在顶栏新增"大/小尺寸切换"按钮 + 设置弹窗分大/小尺寸独立配置行/列，复用 WebSocket 但用新协议 `size_slots` / `current_size` 替代旧 `resize` 消息。

**Architecture:**
- 服务端在 `loadConfig` 中兜底 `sizeSlots`（large=60×120, small=24×80）+ `currentSize`（'large'），新增 `buildSizeSlotsMsg` / `resizeAllPtys` 辅助函数，`createSession` 用 `sizeSlots[currentSize]` 启动 PTY，连接建立时下发 `size_slots`（全量）+ `current_size`，收到 `size_slots` 写槽 + 广播，收到 `current_size` 切尺寸 + 调 PTY + 广播
- 前端删除全局 `rows/cols` 变量、删除 `applySettingsSize` 函数、删除 `settingsRowsInput/ColsInput` 弹窗项，引入 `sizeSlots` / `currentSize` 全局变量、顶栏 `#sizeToggleBtn`、设置弹窗两节（"大尺寸"+"小尺寸"），新增 `applySettingsSizeFor` / `toggleSize` / `updateSizeToggleText`，WebSocket 消息处理改为 `size_slots` / `current_size`
- 旧 `resize` 消息整条删除（双向）

**Tech Stack:** Node.js + node-pty + ws（后端）；xterm.js v6 + 原生 JS（前端）；PM2 进程管理；git 版本控制。

**关联设计文档**：[docs/superpowers/specs/2026-07-01-size-toggle-design.md](../specs/2026-07-01-size-toggle-design.md)

**项目约束**（来自 [AGENTS.md](../../AGENTS.md)）：
- 无测试框架、无 linter、无 formatter
- 单 `main` 分支（2026-06-30 起纳入 git）
- 端口 <端口> 硬编码
- 配置文件：`config.json`
- **每次代码修改完成后必须立即 git commit**
- 禁止 `git add -A`；单步回退用 `git revert HEAD`，禁止 `git reset --hard` 撤销已超过 1 个 commit 的历史
- 每次修改 AGENTS.md 后必须同步更新
- 修改 server.js 时需要重启服务；只改前端时刷新页面即可（用 `Get-NetTCPConnection -LocalPort <端口>` 检查后端是否在跑）
- 重启服务必须走 PM2（`npm run restart` 或前端设置弹窗的「重启服务器」按钮），禁止直接 taskkill
- 每次代码改动必须附带性能影响分析

**改动文件**：

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) | -20 行 / +40 行 / 改 4 处 | config 兜底 + 新协议 + 删 resize |
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | -25 行 / +50 行 / 改 6 处 | 状态变量 + UI 弹窗 + 消息处理 |
| [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) | +约 20 行 | 新增"注意事项 26" + 更新"协议变更" + "前端关键辅助函数"表 |

---

## 阶段划分

本计划分 3 个 commit：

- **Commit 1：后端协议改造** —— Task 1-4
- **Commit 2：前端 UI + 协议适配** —— Task 5-9
- **Commit 3：AGENTS.md 同步** —— Task 10

每个 Task 含若干 Step（每个 Step 2-5 分钟动作）。

---

## Commit 1：后端协议改造

### Task 1: 改造 loadConfig（兜底 sizeSlots + currentSize）

**Files:**
- Modify: [server.js:9-31](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L9-L31) — `loadConfig` 函数体

- [ ] **Step 1.1: 替换 loadConfig 函数体**

定位到 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) 的 `function loadConfig()`（第 9-31 行），用以下代码完整替换：

```javascript
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const def = {
            sizeSlots: { large: { rows: 60, cols: 120 }, small: { rows: 24, cols: 80 } },
            currentSize: 'large',
            hotkeys: {},
            scrollInterval: 100,
            maxBuffer: 10,
            maxFrontendLogs: 50,
            clientTailMax: 4096
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(def, null, 2));
        return def;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    // === sizeSlots 兜底：缺失/非法时填默认值 ===
    if (!cfg.sizeSlots || typeof cfg.sizeSlots !== 'object') cfg.sizeSlots = {};
    if (!cfg.sizeSlots.large) cfg.sizeSlots.large = { rows: 60, cols: 120 };
    if (!cfg.sizeSlots.small) cfg.sizeSlots.small = { rows: 24, cols: 80 };
    for (const k of ['large', 'small']) {
        const s = cfg.sizeSlots[k];
        if (!Number.isInteger(s.rows) || s.rows < 20 || s.rows > 200) s.rows = k === 'large' ? 60 : 24;
        if (!Number.isInteger(s.cols) || s.cols < 20 || s.cols > 200) s.cols = k === 'large' ? 120 : 80;
    }
    // === currentSize 兜底：非 'large'/'small' 时填 'large' ===
    if (cfg.currentSize !== 'large' && cfg.currentSize !== 'small') cfg.currentSize = 'large';

    // 保留：旧 maxBuffer 字段是字符数（如 10000），新格式是 MB（如 10）
    if (typeof cfg.maxBuffer === 'number' && cfg.maxBuffer >= 1000) {
        const mb = Math.round(cfg.maxBuffer / 1000000);
        cfg.maxBuffer = (mb >= 1 && mb <= 90) ? mb : 10;
        console.log(`[migration] maxBuffer 自动从字符数转换为 ${cfg.maxBuffer} MB`);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
    if (typeof cfg.maxBuffer !== 'number' || cfg.maxBuffer < 1 || cfg.maxBuffer > 90) cfg.maxBuffer = 10;
    if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;
    return cfg;
}
```

- [ ] **Step 1.2: 语法验证**

执行：

```bash
node -c server.js && echo "OK"
```

期望：`OK`。如果报错，按提示修正。

- [ ] **Step 1.3: 手动验证 loadConfig**

执行：

```bash
node -e "const cfg = require('./server.js')" 2>&1 | head -20
```

> 注：这会真正启动 server.js（listen <端口>）。Ctrl+C 退出。或用 `node -e "process.exit(0)"` 不行因为 server.js 没暴露函数。

替代方案：临时插入一个 console.log 看 cfg 初始化。

如果以上方式复杂，直接 `npm start` 启动服务，console 应无 `config.sizeSlots` undefined 相关报错。

- [ ] **Step 1.4: 暂不提交（与 Task 2 配对）**

> Task 1-4 合并为单个 commit。Task 4 末尾统一 commit。

---

### Task 2: 增辅助函数 + 改 createSession

**Files:**
- Modify: [server.js:48-49](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L48-L49) — `sessions` / `sessionCounter` 之后
- Modify: [server.js:81-89](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L81-L89) — `createSession` 启动 PTY 部分

- [ ] **Step 2.1: 新增辅助函数**

在 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) 第 49 行（`let sessionCounter = 1;`）之后新增：

```javascript
// 构造 size_slots 全量广播消息
function buildSizeSlotsMsg() {
    return { type: 'size_slots', data: config.sizeSlots };
}

// 调整所有 PTY 尺寸
function resizeAllPtys(rows, cols) {
    Object.values(sessions).forEach(s => s.pty.resize(cols, rows));
}
```

- [ ] **Step 2.2: 改 createSession 启动尺寸**

定位 `function createSession()`（第 81 行），把：

```javascript
    const ptyProcess = pty.spawn('powershell.exe', [], {
        name: 'xterm-color',
        cols: config.cols,
        rows: config.rows,
        cwd: process.env.USERPROFILE,
        env: process.env
    });
```

替换为：

```javascript
    const slot = config.sizeSlots[config.currentSize];
    const ptyProcess = pty.spawn('powershell.exe', [], {
        name: 'xterm-color',
        cols: slot.cols,
        rows: slot.rows,
        cwd: process.env.USERPROFILE,
        env: process.env
    });
```

- [ ] **Step 2.3: 验证语法**

```bash
node -c server.js && echo "OK"
```

期望：`OK`。

---

### Task 3: 改 wss.on('connection') + ws.on('message')

**Files:**
- Modify: [server.js:106-114](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L106-L114) — 连接建立时下发
- Modify: [server.js:152-157](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L152-L157) — resize 处理分支

- [ ] **Step 3.1: 删 resize 下发 + 增 size_slots/current_size 下发**

定位 `wss.on('connection', (ws) => { ... })` 中的：

```javascript
    ws.send(JSON.stringify(buildListMsg()));
    ws.send(JSON.stringify({ type: 'resize', id: 0, data: { rows: config.rows, cols: config.cols } }));
    ws.send(JSON.stringify({ type: 'hotkeys', data: config.hotkeys }));
```

替换为：

```javascript
    ws.send(JSON.stringify(buildListMsg()));
    // === 新增：大/小尺寸槽位 + 当前尺寸（替代旧 resize 下发） ===
    ws.send(JSON.stringify(buildSizeSlotsMsg()));
    ws.send(JSON.stringify({ type: 'current_size', data: config.currentSize }));
    ws.send(JSON.stringify({ type: 'hotkeys', data: config.hotkeys }));
```

- [ ] **Step 3.2: 删 resize 处理 + 增 size_slots/current_size 处理**

定位 `ws.on('message', (msg) => { ... })` 中 `else if (type === 'resize')` 分支（[server.js:152-157](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L152-L157)），删除整段：

```javascript
        else if (type === 'resize') {
            config.rows = data.rows; config.cols = data.cols;
            Object.values(sessions).forEach(s => s.pty.resize(data.cols, data.rows));
            broadcast({ type: 'resize', id: 0, data: { rows: config.rows, cols: config.cols } });
            saveConfig(config);
        }
```

在原 `else if (type === 'hot_keys')` 分支**之前**插入新分支（即紧接 `client_tail_max` 之后、`buffer_size` 之前）：

```javascript
        else if (type === 'size_slots') {
            // C → S: 写 sizeSlots[sizeMode] + 落盘 + 全量广播
            const sizeMode = p.sizeMode;
            if (sizeMode !== 'large' && sizeMode !== 'small') return;
            const r = parseInt(p.rows);
            const c = parseInt(p.cols);
            if (!Number.isInteger(r) || r < 20 || r > 200) return;
            if (!Number.isInteger(c) || c < 20 || c > 200) return;
            config.sizeSlots[sizeMode] = { rows: r, cols: c };
            saveConfig(config);
            broadcast(buildSizeSlotsMsg());
        }
        else if (type === 'current_size') {
            // C → S: 切 currentSize + 调整所有 PTY + 落盘 + 广播
            const size = p.size;
            if (size !== 'large' && size !== 'small') return;
            if (config.currentSize === size) return;  // 无变化则跳过
            config.currentSize = size;
            const slot = config.sizeSlots[size];
            resizeAllPtys(slot.rows, slot.cols);
            saveConfig(config);
            broadcast({ type: 'current_size', data: size });
        }
```

- [ ] **Step 3.3: 验证语法 + 重启后端**

```bash
node -c server.js && echo "OK"
```

期望：`OK`。然后通过设置弹窗的「重启服务器」按钮重启后端（PM2 守护）。

- [ ] **Step 3.4: 手动验证后端协议**

浏览器打开 `http://localhost:<端口>/`，DevTools console：

```javascript
// 应该看到下行（如果可以拦截 ws 消息）
// 实际验证方法：临时在 index.html console.log 所有 ws.onmessage
```

> 由于后端 commit 还没切前端，index.html 仍按 resize 处理，但**不会收到 resize 消息**——会导致 xterm 始终默认 80×24，不算完美但是过渡态（commit 2 修）。
>
> 验证后端是否真发了新消息：在 `ws.onmessage` 里临时加 `console.log('msg:', msg.type);`，刷新页面看 console 应出现 `list`、`size_slots`、`current_size`、`hotkeys`、`scroll_interval`、`max_buffer`、`max_frontend_logs`、`client_tail_max` 8 条消息（**注意不应再有 `resize`**）。
>
> 验证完**回退**临时代码。

- [ ] **Step 3.5: 暂不提交（与 Task 1-2 配对）**

---

### Task 4: 端到端后端验证 + 提交

**Files:**
- Modify: 无（仅验证 + 提交）

- [ ] **Step 4.1: 用设置弹窗重启服务器（验证 PM2 兼容）**

浏览器打开 `http://localhost:<端口>/`，点「设置」→「重启服务器」→ 确认。后端应在 200ms 后退出，PM2 拉起新实例，前端 1 秒后重连。

- [ ] **Step 4.2: 验证 config.json 已写新结构**

```bash
cat config.json
```

期望看到：

```json
{
  "sizeSlots": { "large": {"rows": 60, "cols": 120}, "small": {"rows": 24, "cols": 80} },
  "currentSize": "large",
  ...
}
```

- [ ] **Step 4.3: 提交**

```bash
git add server.js
git commit -m "feat: 新增大/小尺寸槽位协议（size_slots / current_size）

- loadConfig 兜底 sizeSlots（large=60×120, small=24×80）+ currentSize
- 新增 buildSizeSlotsMsg / resizeAllPtys 辅助函数
- createSession 用 sizeSlots[currentSize] 启动 PTY
- 连接建立时下发 size_slots(全量) + current_size
- ws.on('message') 增 size_slots 处理（写槽 + 落盘 + 广播）
- ws.on('message') 增 current_size 处理（切尺寸 + 调 PTY + 落盘 + 广播）
- 删除旧 resize 消息（C→S 和 S→C 双向）

性能影响：
- 后端无新增定时器，saveConfig 频率与现有 max_buffer 等一致（无防抖）
- 广播 payload：size_slots ~100 字节，current_size ~50 字节
- 落盘频率：每个 size_slots/current_size 消息都触发 saveConfig（项目已接受无防抖原则）"
```

---

## Commit 2：前端 UI + 协议适配

### Task 5: 替换全局状态变量

**Files:**
- Modify: [public/index.html:42-50](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L42-L50) — 全局变量声明区

- [ ] **Step 5.1: 替换 rows/cols 全局变量**

定位到内联 `<script>` 块顶部的：

```javascript
        let maxBuffer = 50000;
        // rows / cols 替代原 #rowsInput / #colsInput（2026-06-30 移除 hidden input）
        // 初始 null：服务端 resize 消息到达前不调用 term.resize
        let rows = null;
        let cols = null;
```

替换为：

```javascript
        let maxBuffer = 50000;
        // sizeSlots / currentSize 替代原 rows/cols（2026-07-01 改用 size_slots/current_size 协议）
        // 初始 null：服务端消息到达前不调用 term.resize，也不渲染弹窗默认值
        let sizeSlots = { large: null, small: null };
        let currentSize = null;  // 'large' | 'small' | null
```

- [ ] **Step 5.2: 删除 TermSession 构造里的 rows/cols 守卫**

定位 [public/term-session.js:30-33](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/term-session.js#L30-L33)：

```javascript
        // 若 rows/cols 已就绪则立即 resize
        if (Number.isInteger(rows) && Number.isInteger(cols)) {
            this.term.resize(cols, rows);
        }
```

删除这 4 行。

- [ ] **Step 5.3: 验证无残留引用（应只剩 sizeSlots 路径）**

执行：

```bash
git grep -nE "\\b(rows|cols)\\b" public/index.html public/term-session.js
```

**预期输出**（仅这些行，其他都是脏引用）：

- `public/index.html` 第 49-50 行附近：`let sizeSlots = { large: null, small: null };` / `let currentSize = null;`
- `public/index.html` 中 `sizeSlots.large.rows` / `sizeSlots.large.cols` / `sizeSlots.small.rows` / `sizeSlots.small.cols` 的所有引用（约 10 处）

如果出现其他行（如孤立 `rows =` 或 `cols =`），定位并清理。

> 注意：变量名 `maxBuffer` 不会匹配 `\brows\b`（无边界重叠）。`hotkeys` 不会匹配 `\bcols\b`（无重叠）。

- [ ] **Step 5.4: 暂不提交（与 Task 6-9 配对）**

---

### Task 6: 删 applySettingsSize + 改造设置弹窗

**Files:**
- Modify: [public/index.html:101-131](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L101-L131) — openSettingsModal 弹窗 HTML 拼接
- Modify: [public/index.html:158-163](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L158-L163) — 弹窗同步当前值
- Modify: [public/index.html:198-208](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L198-L208) — `applySettingsSize` 函数

- [ ] **Step 6.1: 替换弹窗 HTML 拼接（删原"终端大小"行，增大/小两节）**

定位到 `openSettingsModal` 函数中：

```javascript
            // 终端大小
            html += '<div class="modal-row">';
            html += '行 <input type="number" id="settingsRowsInput" min="20" max="200" style="width:80px;">';
            html += '列 <input type="number" id="settingsColsInput" min="20" max="200" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-size" onclick="applySettingsSize()">应用</button>';
            html += '</div>';
```

替换为：

```javascript
            // === 终端大小（大尺寸） ===
            html += '<div class="modal-row" style="flex-direction:column;align-items:flex-start;gap:4px;">';
            html += '<div style="color:#a0a0a0;">大尺寸</div>';
            html += '<div style="display:flex;gap:6px;align-items:center;">';
            html += '行 <input type="number" id="settingsLargeRowsInput" min="20" max="200" style="width:80px;">';
            html += '列 <input type="number" id="settingsLargeColsInput" min="20" max="200" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-largeSize" onclick="applySettingsLargeSize()">应用</button>';
            html += '</div></div>';

            // === 终端大小（小尺寸） ===
            html += '<div class="modal-row" style="flex-direction:column;align-items:flex-start;gap:4px;">';
            html += '<div style="color:#a0a0a0;">小尺寸</div>';
            html += '<div style="display:flex;gap:6px;align-items:center;">';
            html += '行 <input type="number" id="settingsSmallRowsInput" min="20" max="200" style="width:80px;">';
            html += '列 <input type="number" id="settingsSmallColsInput" min="20" max="200" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-smallSize" onclick="applySettingsSmallSize()">应用</button>';
            html += '</div></div>';
```

- [ ] **Step 6.2: 替换弹窗同步当前值**

定位到 `openSettingsModal` 末尾的：

```javascript
            document.getElementById('settingsRowsInput').value = rows;
            document.getElementById('settingsColsInput').value = cols;
```

替换为：

```javascript
            document.getElementById('settingsLargeRowsInput').value = sizeSlots.large?.rows ?? 60;
            document.getElementById('settingsLargeColsInput').value = sizeSlots.large?.cols ?? 120;
            document.getElementById('settingsSmallRowsInput').value = sizeSlots.small?.rows ?? 24;
            document.getElementById('settingsSmallColsInput').value = sizeSlots.small?.cols ?? 80;
```

- [ ] **Step 6.3: 替换 applySettingsSize 函数**

定位 `function applySettingsSize()`（第 198-208 行），删除整个函数。

---

### Task 7: 新增 applySettingsSizeFor / toggleSize / updateSizeToggleText

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) — 在 `applySettingsScrollInterval` 函数（[第 210-220 行](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L210-L220)）之后新增

- [ ] **Step 7.1: 新增 4 个函数**

定位到 `function applySettingsClientTailMax()` 函数结束的下一行（紧跟 `}` 之后），新增：

```javascript
        function applySettingsSizeFor(sizeMode) {
            const isLarge = sizeMode === 'large';
            const rInput = document.getElementById(`settings${isLarge ? 'Large' : 'Small'}RowsInput`);
            const cInput = document.getElementById(`settings${isLarge ? 'Large' : 'Small'}ColsInput`);
            const r = parseInt(rInput.value);
            const c = parseInt(cInput.value);
            if (!Number.isInteger(r) || !Number.isInteger(c)) {
                fbBtn(`btn-apply-${sizeMode}Size`, false);
                return;
            }
            // 第一步：写 sizeSlots 槽位（服务端会全量广播 size_slots）
            wsSend({ type: 'size_slots', sizeMode, rows: r, cols: c });
            // 第二步：切到目标尺寸（服务端会广播 current_size + 调 PTY）
            wsSend({ type: 'current_size', size: sizeMode });
            addFrontendLog(`${isLarge ? '大' : '小'}尺寸变更为 ${r}x${c}`);
            fbBtn(`btn-apply-${sizeMode}Size`, true);
        }

        function applySettingsLargeSize() { applySettingsSizeFor('large'); }
        function applySettingsSmallSize() { applySettingsSizeFor('small'); }

        // 顶栏大/小尺寸切换按钮
        function toggleSize() {
            const newSize = currentSize === 'small' ? 'large' : 'small';
            const slot = sizeSlots[newSize];
            if (!slot) return;  // size_slots 消息还没到（极端情况）
            wsSend({ type: 'current_size', size: newSize });
            // 按钮文字由服务端广播 current_size 后回填，避免乐观更新与服务端不一致
        }

        function updateSizeToggleText() {
            const btn = document.getElementById('sizeToggleBtn');
            if (btn) btn.textContent = currentSize === 'small' ? '小' : '大';
        }
```

- [ ] **Step 7.2: 验证无语法错误**

刷新页面（如 commit 1 已完成且后端在跑，**应该能正常加载**——本步只是确认 JS 语法无错）。DevTools console 应无 `Uncaught SyntaxError`。

---

### Task 8: 改造 WebSocket 消息处理

**Files:**
- Modify: [public/index.html:415-418](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L415-L418) — `msg.type === 'resize'` 分支

- [ ] **Step 8.1: 删除 resize 处理分支**

定位 `else if (msg.type === 'resize')` 分支：

```javascript
                    } else if (msg.type === 'resize') {
                        rows = msg.data.rows;
                        cols = msg.data.cols;
                        sessions.forEach(s => s.resize(cols, rows));
                    }
```

删除整段。

- [ ] **Step 8.2: 新增 size_slots 处理 + current_size 处理**

定位到原 `} else if (msg.type === 'hotkeys') {` 分支的**紧前一行**，插入：

```javascript
                    } else if (msg.type === 'size_slots') {
                        sizeSlots = msg.data;  // 全量覆盖
                        // 弹窗打开时同步：仅在 modal 已开时刷新输入框
                        const largeRows = document.getElementById('settingsLargeRowsInput');
                        if (largeRows) {
                            largeRows.value = sizeSlots.large.rows;
                            document.getElementById('settingsLargeColsInput').value = sizeSlots.large.cols;
                            document.getElementById('settingsSmallRowsInput').value = sizeSlots.small.rows;
                            document.getElementById('settingsSmallColsInput').value = sizeSlots.small.cols;
                        }
                    } else if (msg.type === 'current_size') {
                        currentSize = msg.data;
                        const slot = sizeSlots[currentSize];
                        if (slot) {
                            sessions.forEach(s => s.resize(slot.cols, slot.rows));
                        }
                        updateSizeToggleText();
```

- [ ] **Step 8.3: 验证消息处理正确**

刷新页面，DevTools console 应：
- 无 `Uncaught ReferenceError`（rows/cols 已全删）
- 收到 `list` / `size_slots` / `current_size` / `hotkeys` / `scroll_interval` / `max_buffer` / `max_frontend_logs` / `client_tail_max` 共 8 条消息（**不应再有 resize**）
- xterm 应有正确尺寸（60×120 默认大尺寸），按钮显示"大"

---

### Task 9: 顶栏新增 sizeToggleBtn + 端到端测试 + 提交

**Files:**
- Modify: [public/index.html:16-25](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L16-L25) — `.toolbar` 按钮区

- [ ] **Step 9.1: 顶栏新增按钮**

定位 `.toolbar` div：

```html
        <div class="toolbar">
            <button id="sessionSelectBtn"></button>
            <div id="sessionDropdown" class="dropdown-menu"></div>
            <button onclick="renameCurrent()">重命名</button>
            <button onclick="renameAll()">重命名全部</button>
            <button onclick="createNew()">新建终端</button>
            <button onclick="killCurrent()">关闭终端</button>
            <button onclick="openSettingsModal()">设置</button>
            <span id="wsStatus"></span>
        </div>
```

在「设置」按钮之后、`#wsStatus` span 之前新增一行：

```html
            <button id="sizeToggleBtn" onclick="toggleSize()">大</button>
```

- [ ] **Step 9.2: 端到端手动测试**

刷新页面，逐项验证（按 spec 测试清单 1-18）：

| # | 场景 | 步骤 | 期望 |
|---|------|------|------|
| 1 | 首启（无 config.json） | 删除 config.json 后 npm start | 终端 60×120, 按钮"大" |
| 2 | 首连协议下发 | 浏览器打开 | console 看到 size_slots+current_size 两条 |
| 3 | 切换按钮：大→小 | 点 #sizeToggleBtn | 终端变 24×80, 按钮变"小" |
| 4 | 切换按钮：小→大 | 再次点 | 终端变 60×120, 按钮变"大" |
| 5 | 设置弹窗改大尺寸 | 改 80×200，点"应用" | 终端变 80×200, 按钮"大" |
| 6 | 设置弹窗改小尺寸（当前为大） | 改 30×100，点"应用" | 终端变 30×100, 按钮"小" |
| 7 | 新建会话 | 点"新建终端" | 新 PTY 用 sizeSlots[currentSize] 启动 |
| 8 | 关闭所有终端 | 关闭到 0 | 自动创建 |
| 9 | 多客户端 current_size 同步 | A 切小，B 监听 | B 终端跟随 |
| 10 | 多客户端 size_slots 同步 | A 改大尺寸，B 弹窗打开中 | B 输入框刷新 |
| 11 | 重连 | F5 刷新 | 终端恢复正确尺寸 |
| 12 | current_size 无变化 | 大→大 | 不广播 |
| 13 | 非法值 | size_slots rows=999 | 服务端拒收 |
| 14 | 弹窗打开时外部改 size_slots | A 改大尺寸，B 弹窗打开中 | B 弹窗输入框同步 |
| 15 | 按钮文字的更新时机 | 切换瞬间 | 等服务端回填 |
| 16 | 行/列 20-200 范围 | 改 19 或 201 | 弹窗/服务端都拦截 |
| 17 | TermSession 构造时无 sizeSlots | — | xterm 默认 80×24 短暂闪现，current_size 到达后 resize |
| 18 | 老的 resize 消息 | F12 手动发 | 服务端无处理（被忽略） |

- [ ] **Step 9.3: 提交**

```bash
git add public/index.html public/term-session.js
git commit -m "feat: 前端大/小尺寸切换按钮 + 设置弹窗分两节

- 删除全局 rows/cols、applySettingsSize、settingsRowsInput/ColsInput
- 删除 TermSession 构造里的 rows/cols 守卫
- 删除 ws.onmessage 的 resize 处理分支
- 新增 sizeSlots/currentSize 全局变量
- 顶栏新增 #sizeToggleBtn（位置：设置之后、wsStatus 之前）
- 设置弹窗分大/小两节，每节有独立行/列 + 应用按钮
- 新增 applySettingsSizeFor / applySettingsLargeSize / applySettingsSmallSize
- 新增 toggleSize / updateSizeToggleText
- ws.onmessage 新增 size_slots 处理（全量覆盖 + 弹窗打开时同步）
- ws.onmessage 新增 current_size 处理（切尺寸 + 调所有 xterm + 按钮文字）

性能影响：
- DOM：新增 1 个 toolbar 按钮（静态）；弹窗多 2 节 HTML（约 200 字符）
- 事件：toggleSize 1 个 onclick
- 内存：每客户端新增 sizeSlots 引用（2 个对象）+ currentSize 字符串
- 网络：每次应用按钮 = 2 条消息（约 150 字节）
- 布局：toolbar 现 7 按钮 + wsStatus，flex-wrap: wrap 仍生效"
```

---

## Commit 3：AGENTS.md 同步

### Task 10: 更新 AGENTS.md 协议表 + 新增注意事项

**Files:**
- Modify: [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) — WebSocket 协议表 + 新增"注意事项 26"

- [ ] **Step 10.1: 协议表增删**

定位 AGENTS.md 中"WebSocket 协议"小节的表格，做以下 3 类修改：

**删除「resize」相关行**（客户端 → 服务端 + 服务端 → 客户端 各一行）。

**新增 4 行**：

| 方向 | type | 说明 |
|------|------|------|
| 服务端 → 客户端 | `size_slots` | 大/小尺寸槽位广播（连接时下发 data:{large,small}；其他时候也是 data 形式） |
| 服务端 → 客户端 | `current_size` | 当前尺寸（连接时下发 + 切换时广播，data:'large'\|'small'） |
| 客户端 → 服务端 | `size_slots` | 设置大/小尺寸槽位（sizeMode + rows + cols） |
| 客户端 → 服务端 | `current_size` | 切换当前尺寸（size:'large'\|'small'） |

- [ ] **Step 10.2: 前端关键辅助函数表更新**

定位"前端关键辅助函数"小节：

- 删除 `parseHotkey` 列表的注释中如提到 rows/cols
- 在表内新增（或扩展）：

```
- **`toggleSize()`** —— 顶栏大/小尺寸切换按钮。发 `{type: 'current_size', size: 'large'|'small'}` 到服务端，按钮文字由服务端 broadcast current_size 后回填。
- **`applySettingsSizeFor(sizeMode)`** —— 设置弹窗大/小尺寸"应用"按钮。发 size_slots（写槽位）+ current_size（切尺寸）两条消息。
- **`updateSizeToggleText()`** —— 收到 current_size 时更新顶栏按钮文字（大/小）。
```

- [ ] **Step 10.3: 新增注意事项 26**

定位到「已知注意事项」末尾（`scroll_interval` / `max_frontend_logs` 之后），新增：

```markdown
26. **大/小尺寸切换 + 双槽位（2026-07-01 引入）**：顶栏 `#sizeToggleBtn` 按钮在 large/small 之间切换。设置弹窗分大/小两节，每节独立设置行/列。协议：`size_slots`（C→S 写槽 + S→C 全量广播）/ `current_size`（C→S 切换 + S→C 广播当前尺寸）。旧的 `resize` 消息整条删除（C→S 和 S→C 双向）。**应用 = 切换 + 写槽**：用户点"应用"发两条消息（先 size_slots 写槽，再 current_size 切尺寸）。**默认值**：large=60×120, small=24×80。**记忆**：服务端通过 `config.currentSize` 字段记忆上次切换结果，连接建立时下发。**校验**：服务端对 sizeMode/size 必须是 'large'/'small'，rows/cols 必须在 20-200 整数范围内，非法值拒收。`config.sizeSlots` 字段是对象，键为 'large'/'small'，值为 `{rows, cols}`。
```

- [ ] **Step 10.4: 提交**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 新增大/小尺寸切换注意事项 26 + 协议表更新"
```

---

## 完成后验证

```bash
git log --oneline -5
```

期望看到：

```
<新 sha> docs: AGENTS.md 新增大/小尺寸切换注意事项 26 + 协议表更新
<新 sha> feat: 前端大/小尺寸切换按钮 + 设置弹窗分两节
<新 sha> feat: 新增大/小尺寸槽位协议（size_slots / current_size）
ca0236a docs: adding size toggle (large/small) with two-slot design spec
2f7a010 docs: clarify TermSession rows/cols guard removal in size toggle spec
... （更早的 commits）
```

## 回退

- 单步回退：`git revert HEAD`（回到上一 commit 状态）
- 跳到 Commit 1 之前：`git revert <commit3-sha>..<commit1-sha>`（一次性撤销 3 个 feat/docs commits）
- 紧急回退到本特性之前（commit ca0236a 状态）：`git revert <commit1-sha>..<commit3-sha>`
- 手动清理：回退后 config.json 仍保留 sizeSlots/currentSize 字段（无害但冗余），可手动删除或保留

## 后续可选优化（不在本计划范围）

- 当前 20-200 范围硬编码在服务端，可改为 config.json 可配置
- 顶栏按钮可改为图标 + 文字组合（视觉优化）
- 大/小切换时加平滑过渡动画
