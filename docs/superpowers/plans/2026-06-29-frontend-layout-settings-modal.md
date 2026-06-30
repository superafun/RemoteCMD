# 前端布局改造 + 设置弹窗 + maxBuffer 改 MB 单位 + buffer 检测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造前端布局（页面宽度由 xterm 决定，按钮自动换行）；将终端大小、滚动行数、maxBuffer 三类配置统一收纳到设置弹窗；maxBuffer 单位从字符数改为 MB（1 MB = 1,000,000 字符）；弹窗内新增 buffer 检测功能（显示当前会话已用/上限/百分比）；服务端 buffer 存储引入滞回式截断提升性能。

**Architecture:**
- 前端单文件 SPA：CSS 改 body 宽度规则；顶栏精简到 6 个按钮 + 1 个下拉 + 状态灯；原 4 个 input 改为 hidden（id 保持兼容）；新增设置弹窗（复用现有 modal 样式）。
- 后端：缓存 `maxBufferChars` 模块级变量；`onData` 改用滞回式截断（超 2x 触发，截到 1x）；新增 `buffer_size` 协议；`loadConfig` 加 maxBuffer 迁移逻辑（旧的字符数自动转 MB）。
- 协议：新增 `buffer_size` 双向消息；`max_buffer` 语义改为 MB。
- 配置文件：1 次性更新 `config.json` 的 maxBuffer 字段。

**Tech Stack:** Node.js + Express + WebSocket + node-pty；前端 vanilla JS + xterm.js v6 + 内联 CSS。

**项目无 git 仓库**（[AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 已注明），无测试框架。所有任务以「手动验证」步骤结尾。

---

## 文件结构

| 文件 | 改动性质 | 职责 |
|------|----------|------|
| [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) | 改 | maxBufferChars 缓存 + 滞回式截断 + 迁移 + buffer_size 协议 |
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | 改 | 布局 CSS + 顶栏精简 + hidden inputs + 设置弹窗 + buffer_size 客户端 |
| [config.json](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/config.json) | 改 1 字段 | maxBuffer 字符 → MB（迁移由 server.js 自动处理） |
| [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) | 改 | 更新已知注意事项（buffer 语义、协议、布局） |
| [docs/superpowers/specs/2026-06-29-frontend-layout-settings-modal-design.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/docs/superpowers/specs/2026-06-29-frontend-layout-settings-modal-design.md) | 不改 | 设计参考（实施时按本文档） |

---

## Task 1: 后端 — maxBufferChars 缓存 + 滞回式截断

**Files:**
- Modify: [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js):20-21（loadConfig 后）、60-80（createSession onData）

- [ ] **Step 1: 在 loadConfig 后加 maxBufferChars 缓存变量**

打开 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js)，找到第 20 行 `let config = loadConfig();`，在它后面加：

```javascript
let config = loadConfig();
// 缓存 maxBuffer 对应的字符数（1 MB = 1,000,000 字符），仅在配置变更时重算
let maxBufferChars = (config.maxBuffer || 10) * 1000000;
```

- [ ] **Step 2: 修改 createSession 的 onData 改用滞回式截断**

找到 [server.js:70-74](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L70-L74) 的 onData 回调（`ptyProcess.onData((d) => { ... })`），替换为：

```javascript
    ptyProcess.onData((d) => {
        if (d.includes('\x1b[2J')) sessions[newId].buffer = '';  // 清屏同步
        sessions[newId].buffer += d;
        // 滞回式：超 2x 才截断，截到 1x（避免每帧 O(N) slice）
        if (sessions[newId].buffer.length > maxBufferChars * 2) {
            sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
        }
        broadcast({ type: 'data', id: newId, data: d });
    });
```

完整改动后 createSession 内的 `ptyProcess.onData` 段是这样：

```javascript
    sessions[newId] = { pty: ptyProcess, buffer: '', name: computeSmartName(newId) };
    ptyProcess.onData((d) => {
        if (d.includes('\x1b[2J')) sessions[newId].buffer = '';  // 清屏同步
        sessions[newId].buffer += d;
        // 滞回式：超 2x 才截断，截到 1x（避免每帧 O(N) slice）
        if (sessions[newId].buffer.length > maxBufferChars * 2) {
            sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
        }
        broadcast({ type: 'data', id: newId, data: d });
    });
```

- [ ] **Step 3: 手动验证 — 启动服务看 buffer 截断正常**

```bash
# 后台启动
cd C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD
node server.js
```

打开 `http://localhost:65433`，终端里跑：

```powershell
while ($true) { "x" * 1000; Start-Sleep 0.1 }
```

让终端持续输出 30 秒。预期：
- 终端不卡顿
- 在浏览器 F12 → Console 输入：`terms[activeId]._core.buffer.x > 10000`（xterm 内部 buffer）
- 不报错（说明 buffer 截断逻辑没破坏数据流）

按 Ctrl+C 终止输出，点顶栏「关闭终端」结束会话。

```bash
# 关闭服务
# 在启动 node server.js 的终端按 Ctrl+C
```

---

## Task 2: 后端 — config 迁移逻辑（自动转换旧字符数为 MB）

**Files:**
- Modify: [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js):9-19（loadConfig 函数）

- [ ] **Step 1: 修改 loadConfig 加迁移逻辑**

找到 [server.js:9-16](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L9-L16) 的 `loadConfig` 函数，替换为：

```javascript
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const def = { rows: 60, cols: 118, hotkeys: {}, scrollStep: 3, maxBuffer: 10 };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(def, null, 2));
        return def;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // 迁移：旧 maxBuffer 字段是字符数（如 10000），新格式是 MB（如 10）
    // 检测规则：值 >= 1000 视为旧字符数（10 MB = 10,000,000 字符远大于 1000）
    if (typeof cfg.maxBuffer === 'number' && cfg.maxBuffer >= 1000) {
        const mb = Math.round(cfg.maxBuffer / 1000000);
        cfg.maxBuffer = (mb >= 1 && mb <= 90) ? mb : 10;
        console.log(`[migration] maxBuffer 自动从字符数转换为 ${cfg.maxBuffer} MB`);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
    // 兜底：缺失或非法值
    if (typeof cfg.maxBuffer !== 'number' || cfg.maxBuffer < 1 || cfg.maxBuffer > 90) {
        cfg.maxBuffer = 10;
    }
    return cfg;
}
```

注意：原 loadConfig 默认值用的是 `rows: 30, cols: 80`，但 [config.json](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/config.json) 实际是 `rows: 60, cols: 118`，这里保留 `60, 118` 以匹配实际配置。

- [ ] **Step 2: 手动验证 — 迁移逻辑**

```bash
# 先看当前 config.json
cat C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\config.json
```

应该看到 `"maxBuffer": 10000`（旧字符数）。

```bash
# 启动服务（触发迁移）
cd C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD
node server.js
```

预期输出：
```
[迁移] maxBuffer 自动从字符数转换为 10 MB
```

如果没看到这行，检查控制台输出。Ctrl+C 终止。

```bash
# 验证 config.json 已被更新
cat C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\config.json
```

应该看到 `"maxBuffer": 10`。

再次启动服务验证不再触发迁移：

```bash
node server.js
```

预期：无 `[migration]` 日志。

Ctrl+C 终止。

- [ ] **Step 3: 手动验证 — 内存使用正常**

启动后开 `http://localhost:65433`，跑持续输出：

```powershell
while ($true) { "x" * 100; Start-Sleep 0.05 }
```

等 10 秒。打开任务管理器（Ctrl+Shift+Esc），看 `node.exe` 进程内存占用。

预期：内存增长有限（< 80 MB 包含 V8 启动 + buffer 缓存）。

Ctrl+C 终止输出，关闭浏览器，关服务。

---

## Task 3: 后端 — max_buffer 消息更新缓存 + buffer_size 协议

**Files:**
- Modify: [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js):96-130（wss.on('message') 处理器）

- [ ] **Step 1: 在 max_buffer 处理中更新缓存**

找到 [server.js:112-116](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L112-L116) 附近的：

```javascript
        else if (type === 'max_buffer') {
            config.maxBuffer = data;
            broadcast({ type: 'max_buffer', data: config.maxBuffer });
            saveConfig(config);
        }
```

替换为：

```javascript
        else if (type === 'max_buffer') {
            config.maxBuffer = data;
            maxBufferChars = data * 1000000;  // 关键：更新缓存
            broadcast({ type: 'max_buffer', data: config.maxBuffer });
            saveConfig(config);
        }
```

- [ ] **Step 2: 在 buffer 响应中用缓存的 maxBufferChars 做上限保护**

找到 [server.js:95](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L95) 的 `buffer` 处理：

```javascript
        else if (type === 'buffer' && sessions[id]) ws.send(JSON.stringify({ type: 'buffer', id, data: sessions[id].buffer }));
```

替换为：

```javascript
        else if (type === 'buffer' && sessions[id]) {
            const buf = sessions[id].buffer;
            // 上限保护：保证下行不超过 maxBuffer
            const data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
            ws.send(JSON.stringify({ type: 'buffer', id, data }));
        }
```

- [ ] **Step 3: 新增 buffer_size 协议处理**

在 `max_buffer` 分支后面（[server.js:116](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L116) 之后，`rename` 分支之前）加：

```javascript
        else if (type === 'buffer_size' && sessions[id]) {
            ws.send(JSON.stringify({
                type: 'buffer_size',
                id,
                used: sessions[id].buffer.length,
                max: maxBufferChars
            }));
        }
```

完整改后的 wss.on('message') 段（[server.js:89-130](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L89-L130) 附近）形如：

```javascript
    ws.on('message', (msg) => {
        const p = JSON.parse(msg.toString());
        const { type, id, data } = p;
        if (type === 'create') createSession();
        else if (type === 'input' && sessions[id]) sessions[id].pty.write(data);
        else if (type === 'kill' && sessions[id]) sessions[id].pty.kill();
        else if (type === 'buffer' && sessions[id]) {
            const buf = sessions[id].buffer;
            const data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
            ws.send(JSON.stringify({ type: 'buffer', id, data }));
        }
        else if (type === 'resize') {
            config.rows = data.rows; config.cols = data.cols;
            Object.values(sessions).forEach(s => s.pty.resize(data.cols, data.rows));
            broadcast({ type: 'resize', id: 0, data: { rows: config.rows, cols: config.cols } });
            saveConfig(config);
        }
        else if (type === 'hot_keys') {
            config.hotkeys = data || {};
            broadcast({ type: 'hotkeys', data: config.hotkeys });
            saveConfig(config);
        }
        else if (type === 'scroll_step') {
            config.scrollStep = data;
            broadcast({ type: 'scroll_step', data: config.scrollStep });
            saveConfig(config);
        }
        else if (type === 'max_buffer') {
            config.maxBuffer = data;
            maxBufferChars = data * 1000000;  // 关键：更新缓存
            broadcast({ type: 'max_buffer', data: config.maxBuffer });
            saveConfig(config);
        }
        else if (type === 'buffer_size' && sessions[id]) {
            ws.send(JSON.stringify({
                type: 'buffer_size',
                id,
                used: sessions[id].buffer.length,
                max: maxBufferChars
            }));
        }
        else if (type === 'rename' && sessions[id]) {
            // ... (既有代码)
        }
        // ... 其他既有分支保持不变
    });
```

- [ ] **Step 4: 手动验证 — buffer_size 协议**

启动服务：

```bash
cd C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD
node server.js
```

打开 `http://localhost:65433`，F12 → Console 输入：

```javascript
// 发送 buffer_size 请求
ws.send(JSON.stringify({ type: 'buffer_size', id: parseInt(activeId) }));
```

等 1 秒，看 onmessage 输出。预期收到：

```javascript
{type: 'buffer_size', id: 1, used: <某个数字>, max: 10000000}
```

`max` 应该是 `10000000`（10 MB）。

再输入：

```javascript
// 改 maxBuffer 为 5
ws.send(JSON.stringify({ type: 'max_buffer', data: 5 }));
// 再请求
ws.send(JSON.stringify({ type: 'buffer_size', id: parseInt(activeId) }));
```

预期收到 `max: 5000000`（5 MB）。

Ctrl+C 关服务。

---

## Task 4: 前端 — 布局 CSS（body 宽度由 xterm 决定）

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html):10-19（`<style>` 内的 body 规则）

- [ ] **Step 1: 修改 body 宽度规则**

找到 [public/index.html:11-19](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L11-L19)：

```css
        html {
            overflow-x: auto;
        }
        body {
            margin: 0;
            padding: 0;
            width: max-content;
            min-width: 100%;
        }
```

替换为：

```css
        html {
            overflow-x: auto;  /* 兜底：xterm 本身比视口宽时滚动 */
        }
        body {
            margin: 0;
            padding: 0;
            width: max-content;  /* 关键：宽度跟随最宽子元素（#terminal-container） */
        }
        #terminal-container {
            width: max-content;  /* 由 xterm 撑开 */
        }
```

- [ ] **Step 2: 修改 .toolbar 和 #hotkeys-bar 规则**

找到 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 的 `.toolbar` 和 `#hotkeys-bar` 相关样式。`.toolbar` 用了 inline style（`style="position:relative;"`），需要在 `<style>` 里加新规则覆盖：

在 `</style>` 之前（[public/index.html:142](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L142) 之前）加：

```css
        .toolbar, #hotkeys-bar {
            width: fit-content;  /* 跟随 body（xterm）宽度 */
            max-width: 100%;
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            align-items: center;
        }
```

- [ ] **Step 3: 手动验证 — 布局效果**

启动服务（如果还没启动）：

```bash
# 检查端口占用
Get-NetTCPConnection -LocalPort 65433
# 如果未运行：
cd C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD
node server.js
```

打开 `http://localhost:65433`，F12 → Console 输入：

```javascript
console.log('body width:', document.body.offsetWidth, 'terminal width:', document.getElementById('terminal-container').offsetWidth);
```

预期：两个值相等（body 宽度 = xterm 容器宽度）。

把浏览器窗口缩到 ~400px 宽，预期：
- 顶栏按钮折行（`重命名` 旁边自动换行）
- 快捷键栏按钮折行

拉宽到 ~1600px，预期：
- 顶栏按钮回到一行
- 快捷键栏按钮回到一行

---

## Task 5: 前端 — 顶栏精简（移除 4 个 input 和 3 个按钮）

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html):147-161（顶栏 `.toolbar` DOM）

- [ ] **Step 1: 替换顶栏 DOM**

找到 [public/index.html:147-161](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L147-L161)：

```html
    <div class="toolbar" style="position:relative;">
        <select id="sessionSelect"></select>
        <button onclick="renameCurrent()">重命名</button>
        <button onclick="renameAll()">重命名全部</button>
        <input type="number" id="rowsInput" min="20" max="200">
        <input type="number" id="colsInput" min="20" max="200">
        <button onclick="applySize()">确定</button>
        <button onclick="createNew()">新建终端</button>
        <button onclick="killCurrent()">关闭终端</button>
        <input type="number" id="scrollStepInput" min="1" max="100" value="3">
        <button onclick="applyScrollStep()">确定</button>
        <input type="number" id="maxBufferInput" min="1000" max="90000000" value="50000">
        <button onclick="applyMaxBuffer()">缓存</button>
        <span id="wsStatus" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);"></span>
    </div>
```

替换为：

```html
    <div class="toolbar" style="position:relative;">
        <select id="sessionSelect"></select>
        <button onclick="renameCurrent()">重命名</button>
        <button onclick="renameAll()">重命名全部</button>
        <button onclick="createNew()">新建终端</button>
        <button onclick="killCurrent()">关闭终端</button>
        <button onclick="openSettingsModal()">设置</button>
        <span id="wsStatus" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);"></span>
    </div>
```

- [ ] **Step 2: 在 `<body>` 末尾、`<script>` 标签之前加 hidden input 占位**

找到 `<script src="./xterm/lib/xterm.js"></script>`（[public/index.html:172](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L172)）之前，加：

```html
    <!-- 4 个 hidden input 占位（保持原 id，让 onmessage 处理器能继续更新其 value） -->
    <input type="hidden" id="rowsInput">
    <input type="hidden" id="colsInput">
    <input type="hidden" id="scrollStepInput">
    <input type="hidden" id="maxBufferInput">
```

这些 hidden input 仍保留原 id `rowsInput / colsInput / scrollStepInput / maxBufferInput`，让现有 onmessage 的 `resize / scroll_step / max_buffer` 分支中的 `document.getElementById('xxxInput').value = ...` 不需修改。

- [ ] **Step 3: 删除现已无人调用的 apply* 函数**

找到 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 的 `applySize() / applyScrollStep() / applyMaxBuffer()` 三个函数（约 371-376、523-529、532-538 行）。删除这三个函数。注：弹窗内会新增 `applySettingsSize / applySettingsScrollStep / applySettingsMaxBuffer` 三个新函数（见 Task 6）。

`applySize` 删除参考（连同上面的空行）：

```javascript
        function applySize() {
            const r = parseInt(document.getElementById('rowsInput').value);
            const c = parseInt(document.getElementById('colsInput').value);
            ws.send(JSON.stringify({ type: 'resize', id: 0, data: { rows: r, cols: c } }));
        }


        function sendSgrWheel(dir) {
```

`applyScrollStep` 删除参考：

```javascript
        // === 滚动步长 ===
        function applyScrollStep() {
            const v = parseInt(document.getElementById('scrollStepInput').value);
            if (Number.isInteger(v)) {
                scrollStep = v;
                ws.send(JSON.stringify({ type: 'scroll_step', data: scrollStep }));
            }
        }

        // === 缓存数量 ===
```

`applyMaxBuffer` 删除参考（保留后面 `applyMaxBuffer` 之后到 `// === 连接状态检测 ===` 之间的内容）：

```javascript
        // === 缓存数量 ===
        function applyMaxBuffer() {
            const v = parseInt(document.getElementById('maxBufferInput').value);
            if (Number.isInteger(v)) {
                maxBuffer = v;
                ws.send(JSON.stringify({ type: 'max_buffer', data: maxBuffer }));
            }
        }

        // === 连接状态检测 ===
```

- [ ] **Step 4: 手动验证 — 顶栏精简**

刷新 `http://localhost:65433`（Ctrl+F5 强制刷新），预期：
- 顶栏只有 6 个按钮：会话下拉、重命名、重命名全部、新建终端、关闭终端、设置
- 没有「确定」「缓存」按钮
- F12 → Elements，搜索 `rowsInput`，应找到 1 个 `<input type="hidden" id="rowsInput">`
- 顶栏 4 个 input 不在 .toolbar 内

终端仍能正常输入输出（不破现有功能）。

---

## Task 6: 前端 — 设置弹窗 + 应用函数

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html)（在 `connect()` 函数之前加新函数）

- [ ] **Step 1: 添加 settingsDiv 全局变量**

找到 `let isFirstList = true;`（[public/index.html:187](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L187)）附近，在它后面加：

```javascript
        let isFirstList = true;  // 重连后的第一个 list 标志
        let settingsDiv = null;  // 设置弹窗 DOM 句柄
```

- [ ] **Step 2: 添加 openSettingsModal / closeSettingsModal 函数**

在 `parseHotkey(s)` 函数（[public/index.html:190](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L190)）之前、`availableKeys` 之后，加：

```javascript
        // === 设置弹窗 ===
        function openSettingsModal() {
            if (settingsDiv) { settingsDiv.remove(); settingsDiv = null; }
            let html = '<div class="modal-overlay">';
            html += '<div class="modal-box" style="min-width:420px;">';
            html += '<h3>设置</h3>';

            // 终端大小
            html += '<div class="modal-row">';
            html += '行 <input type="number" id="settingsRowsInput" min="20" max="200" style="width:80px;">';
            html += '列 <input type="number" id="settingsColsInput" min="20" max="200" style="width:80px;">';
            html += '<button class="btn-primary" onclick="applySettingsSize()">应用</button>';
            html += '</div>';

            // 滚动行数
            html += '<div class="modal-row">';
            html += '滚动行数 <input type="number" id="settingsScrollStepInput" min="1" max="100" style="width:80px;">';
            html += '<button class="btn-primary" onclick="applySettingsScrollStep()">应用</button>';
            html += '</div>';

            // 缓冲区上限 (MB)
            html += '<div class="modal-row">';
            html += '缓冲区上限 (MB) <input type="number" id="settingsMaxBufferInput" min="1" max="90" style="width:80px;">';
            html += '<button class="btn-primary" onclick="applySettingsMaxBuffer()">应用</button>';
            html += '</div>';

            // 缓冲区检测
            html += '<div class="modal-row">';
            html += '<button onclick="queryBufferSize()" id="queryBufferSizeBtn">检测当前会话</button>';
            html += '</div>';
            html += '<div id="bufferSizeResult" class="empty-hint" style="text-align:left;font-style:normal;color:#c0c0c0;padding:8px 0 0 0;"></div>';

            html += '<div class="modal-actions">';
            html += '<button onclick="closeSettingsModal()" style="margin-left:auto;">关闭</button>';
            html += '</div>';
            html += '</div></div>';

            const div = document.createElement('div');
            div.innerHTML = html;
            settingsDiv = div.firstElementChild;
            document.body.appendChild(settingsDiv);

            // 同步当前值到弹窗
            document.getElementById('settingsRowsInput').value = document.getElementById('rowsInput').value;
            document.getElementById('settingsColsInput').value = document.getElementById('colsInput').value;
            document.getElementById('settingsScrollStepInput').value = scrollStep;
            document.getElementById('settingsMaxBufferInput').value = maxBuffer;

            // 同步「检测」按钮的禁用态
            const queryBtn = document.getElementById('queryBufferSizeBtn');
            if (queryBtn) queryBtn.disabled = !activeId;
        }

        function closeSettingsModal() {
            if (settingsDiv) { settingsDiv.remove(); settingsDiv = null; }
        }

        function applySettingsSize() {
            const r = parseInt(document.getElementById('settingsRowsInput').value);
            const c = parseInt(document.getElementById('settingsColsInput').value);
            if (Number.isInteger(r) && Number.isInteger(c)) {
                ws.send(JSON.stringify({ type: 'resize', id: 0, data: { rows: r, cols: c } }));
            }
        }

        function applySettingsScrollStep() {
            const v = parseInt(document.getElementById('settingsScrollStepInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 100) {
                scrollStep = v;
                ws.send(JSON.stringify({ type: 'scroll_step', data: scrollStep }));
            }
        }

        function applySettingsMaxBuffer() {
            const v = parseInt(document.getElementById('settingsMaxBufferInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 90) {
                maxBuffer = v;  // 存 MB
                ws.send(JSON.stringify({ type: 'max_buffer', data: maxBuffer }));
            }
        }

        function queryBufferSize() {
            if (!activeId) return;
            const btn = document.getElementById('queryBufferSizeBtn');
            btn.textContent = '检测中...';
            btn.disabled = true;
            ws.send(JSON.stringify({ type: 'buffer_size', id: parseInt(activeId) }));
            // 5s 超时：响应未到则强制恢复按钮
            setTimeout(() => {
                if (btn.disabled) {
                    btn.textContent = '检测当前会话';
                    btn.disabled = false;
                }
            }, 5000);
        }
```

- [ ] **Step 3: 在 switchSession 中同步「检测」按钮的可用性**

找到 `function switchSession(id)`（[public/index.html:337](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L337) 附近），在 `document.getElementById('sessionSelect').value = id;` 后加：

```javascript
            // 弹窗打开时同步「检测」按钮的可用性
            const queryBtn = document.getElementById('queryBufferSizeBtn');
            if (queryBtn) queryBtn.disabled = !activeId;
```

完整改后的 switchSession 形如：

```javascript
        function switchSession(id) {
            if (activeId === id) return;
            if (activeId && wrappers[activeId]) {
                wrappers[activeId].style.display = 'none';
            }
            activeId = id;
            if (wrappers[id]) {
                wrappers[id].style.display = 'block';
                terms[id].focus();
            }
            document.getElementById('sessionSelect').value = id;
            // 弹窗打开时同步「检测」按钮的可用性
            const queryBtn = document.getElementById('queryBufferSizeBtn');
            if (queryBtn) queryBtn.disabled = !activeId;
        }
```

- [ ] **Step 4: 手动验证 — 设置弹窗**

刷新 `http://localhost:65433`。预期：
- 顶栏多出「设置」按钮
- 点「设置」→ 弹窗出现，含 4 块：终端大小、滚动行数、缓冲区上限(MB)、缓冲区检测
- 4 个 input 有合理初值（rows=60, cols=118, scrollStep=10, maxBuffer=10）
- 「检测当前会话」按钮可用

测试修改：
1. 把「行」改为 40，点「应用」→ 终端高度应变矮
2. 把「滚动行数」改为 5，点「应用」→ 滚动按钮按 5 行工作
3. 把「缓冲区上限」改为 20，点「应用」
4. F12 → Console 输入 `document.getElementById('maxBufferInput').value`（hidden input）→ 应返回 20
5. 点「关闭」→ 弹窗消失

终端功能正常不破。

---

## Task 7: 前端 — buffer_size 客户端响应

**Files:**
- Modify: [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html):296-299（`max_buffer` 分支之后）

- [ ] **Step 1: 在 onmessage 的 max_buffer 分支后加 buffer_size 分支**

找到 `} else if (msg.type === 'max_buffer') { ... }`（约 [public/index.html:296](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L296)），在它后面、`};` 结束 onmessage 之前，加：

```javascript
                    } else if (msg.type === 'buffer_size') {
                        const usedMB = (msg.used / 1000000).toFixed(2);
                        const maxMB = (msg.max / 1000000).toFixed(2);
                        const pct = msg.max > 0 ? ((msg.used / msg.max) * 100).toFixed(1) : '0';
                        const resultEl = document.getElementById('bufferSizeResult');
                        if (resultEl) {
                            resultEl.textContent = `当前会话占用: ${usedMB} MB / ${maxMB} MB (${pct}%)`;
                        }
                        // 恢复按钮状态
                        const btn = document.getElementById('queryBufferSizeBtn');
                        if (btn) { btn.textContent = '检测当前会话'; btn.disabled = false; }
                    }
```

完整 onmessage 的尾部形如：

```javascript
                    } else if (msg.type === 'scroll_step') {
                        scrollStep = msg.data;
                        document.getElementById('scrollStepInput').value = scrollStep;
                    } else if (msg.type === 'max_buffer') {
                        maxBuffer = msg.data;
                        document.getElementById('maxBufferInput').value = maxBuffer;
                    } else if (msg.type === 'buffer_size') {
                        const usedMB = (msg.used / 1000000).toFixed(2);
                        const maxMB = (msg.max / 1000000).toFixed(2);
                        const pct = msg.max > 0 ? ((msg.used / msg.max) * 100).toFixed(1) : '0';
                        const resultEl = document.getElementById('bufferSizeResult');
                        if (resultEl) {
                            resultEl.textContent = `当前会话占用: ${usedMB} MB / ${maxMB} MB (${pct}%)`;
                        }
                        const btn = document.getElementById('queryBufferSizeBtn');
                        if (btn) { btn.textContent = '检测当前会话'; btn.disabled = false; }
                    }
                };
```

- [ ] **Step 2: 手动验证 — buffer 检测端到端**

启动服务（如未运行）：

```bash
cd C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD
node server.js
```

打开 `http://localhost:65433`，刷新（Ctrl+F5）：

1. 点顶栏「设置」→ 弹窗出现
2. 在终端跑持续输出：`while ($true) { Get-Date; Start-Sleep 1 }`
3. 弹窗里点「检测当前会话」
4. 预期：1 秒内显示 `当前会话占用: 0.05 MB / 10.00 MB (0.5%)` 之类的文本（数字随时间增加）
5. 多点几次检测 → 数字应逐步增长
6. 点顶栏「关闭终端」→ 弹窗内「检测当前会话」按钮应变灰（disabled）
7. 在弹窗打开状态下用下拉框切到其他会话 → 「检测」按钮应变可用

测试超时：DevTools → Network → Offline，再点「检测」→ 5 秒后按钮应自动恢复（不会再永远 disabled）。

切回 Online。

---

## Task 8: AGENTS.md 文档更新

**Files:**
- Modify: [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md):73-75、110、120 附近

- [ ] **Step 1: 更新「WebSocket 协议」表格的 max_buffer 协议行**

找到 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 的「**服务端 → 客户端：**」表格（约 47-55 行），在末尾加：

```markdown
| `buffer_size` | 当前会话 buffer 占用查询响应（id + used + max，单位：字符数） |
```

找到「**客户端 → 服务端：**」表格（约 56-68 行），在末尾加：

```markdown
| `buffer_size` | 查询当前会话 buffer 占用（id） |
```

- [ ] **Step 2: 更新「会话生命周期」段落**

找到 [AGENTS.md:73-75](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md#L73-L75)：

```markdown
- 缓冲区上限为 **maxBuffer 字符**（默认 50000），可通过 `config.json` 的 `maxBuffer` 字段配置；超出时从头部截断。
```

替换为：

```markdown
- 缓冲区上限以 **MB** 存储（默认 10 MB），通过 `config.json` 的 `maxBuffer` 字段配置；1 MB = 1,000,000 字符。**滞回式截断**：服务端 `ptyProcess.onData` 中，只有当 `buffer.length > maxBufferChars * 2` 时才触发 `slice(-maxBufferChars)`；日常写入路径只做 `buffer += d`（V8 rope 字符串摊销 O(1)）。`maxBufferChars` 是模块级缓存变量，仅在 `loadConfig` 和 `max_buffer` 消息处理时重算。
```

- [ ] **Step 3: 更新「已知注意事项」第 2 条**

找到 [AGENTS.md:110](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md#L110)：

```markdown
2. **缓冲区上限由 `config.json` 的 `maxBuffer` 控制**（默认 50000），可在顶栏输入框实时修改并同步所有客户端。服务端：`.slice(-(config.maxBuffer || 50000))`。
```

替换为：

```markdown
2. **缓冲区上限由 `config.json` 的 `maxBuffer` 控制**（默认 10 MB，1 MB = 1,000,000 字符），在设置弹窗内输入并实时同步所有客户端。服务端用模块级 `maxBufferChars` 缓存；`onData` 中用滞回式截断（超 2x 触发 slice）。`loadConfig` 自动迁移旧字符数格式（值 ≥ 1000 时视为字符，自动转 MB 并落盘）。
```

- [ ] **Step 4: 在「已知注意事项」末尾加 2 条新条目**

找到 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 第 12 条之后（120 行后）加：

```markdown
13. **前端布局**：body 宽度由 `#terminal-container`（xterm）决定，`.toolbar` 和 `#hotkeys-bar` 用 `flex-wrap: wrap` 自动换行。`html { overflow-x: auto }` 是兜底（xterm 本身比视口宽时出现水平滚动条）。
14. **设置弹窗**：顶栏「设置」按钮打开。包含终端大小、滚动行数、缓冲区上限(MB)、缓冲区检测 4 块。复用现有 `.modal-overlay / .modal-box` 样式。`settingsDiv` 是全局 DOM 句柄（与 `editorDiv` 对称）。
15. **buffer 检测**：客户端发 `{type:'buffer_size', id}`，服务端回 `{type:'buffer_size', id, used, max}`（字符数）。前端用 `/ 1000000` 转 MB 显示。「检测」按钮在 `activeId` 为空时 disabled，弹窗打开和 `switchSession` 时同步状态；5s 超时强制恢复按钮（防断网时永久 disabled）。
```

- [ ] **Step 5: 手动验证 — 文档一致**

通读改后的 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md)：
- 协议表格含 `buffer_size` 双向
- 会话生命周期段落说明 MB 单位和滞回式
- 注意事项 2 说明 MB 字符换算和迁移
- 注意事项 13/14/15 描述布局、弹窗、buffer 检测

按 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 「更新规则」要求，**通知用户本次修改了 AGENTS.md**。

---

## Task 9: 端到端验证

- [ ] **Step 1: 全栈启动**

```bash
Get-NetTCPConnection -LocalPort 65433
# 如果已运行则无需重启（只改前端时直接刷新即可）
cd C:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD
node server.js  # 仅当 server.js 改动时需要重启
```

打开 `http://localhost:65433`，Ctrl+F5 强制刷新。

- [ ] **Step 2: 验证清单**

逐项打勾：

- [ ] 布局：body 宽度 = xterm 宽度（DevTools 测量 `document.body.offsetWidth === document.getElementById('terminal-container').offsetWidth`）
- [ ] 顶栏：6 个按钮（重命名、重命名全部、新建终端、关闭终端、设置）+ 1 个下拉 + 1 个状态灯，无 input
- [ ] 快捷键栏：4 个滚动按钮 + 编辑按钮 + 热键按钮列表，按钮自动换行
- [ ] 设置弹窗：点顶栏「设置」打开，4 块结构完整（终端大小/滚动行数/缓冲区上限/检测）
- [ ] 弹窗样式：与现有快捷键编辑弹窗风格一致（背景 #1e1e1e、按钮 #3c3c3c、应用按钮 #0078d4）
- [ ] 终端大小应用：改行/列后点「应用」→ 终端尺寸变化，state 显示
- [ ] 滚动行数应用：改值后点「应用」→ ▲上滑终端连点 N 次共上滑 N×scrollStep 行
- [ ] maxBuffer 应用：改 10 → 20 后点「应用」→ hidden input value = 20；服务端 console.log(config.maxBuffer) = 20；config.json 落盘为 20
- [ ] buffer 检测：点「检测」后 1 秒内显示 `当前会话占用: X.XX MB / Y.YY MB (Z.Z%)`，数字随输出量增长
- [ ] 检测按钮禁用：关闭当前会话后「检测」按钮 disabled；切换会话后恢复
- [ ] 检测超时：断网后点「检测」→ 5 秒后按钮自动恢复
- [ ] 多客户端：另一 tab 打开 `http://localhost:65433`，设置同步
- [ ] 断网重连：DevTools Offline 30 秒后取消 → 终端内容补回；弹窗仍能打开
- [ ] UTF-8：终端跑 `while ($true) { "你好世界"; Start-Sleep 0.1 }` → 中文显示无乱码
- [ ] 截断性能：maxBuffer=1 MB + `while ($true) { "x" * 1000 }` 高输出下，V8 内存 < 100 MB
- [ ] AGENTS.md：已更新且符合 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 已知现状

- [ ] **Step 3: 关闭测试环境**

```bash
# 关闭服务（如有）
# 在启动 node server.js 的终端按 Ctrl+C
```

- [ ] **Step 4: 通知用户**

按 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 「更新规则」要求，告知用户：
- AGENTS.md 已更新（新增 13/14/15 注意事项，修改 2/会话生命周期段落）
- 修改的文件清单（[server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js)、[public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html)、[config.json](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/config.json)、[AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md)）

---

## 自审结果

**1. Spec 覆盖**：
- ✅ 布局改造：Task 4
- ✅ 顶栏精简：Task 5
- ✅ 设置弹窗 4 块：Task 6
- ✅ maxBuffer 改 MB：Task 1 (maxBufferChars 缓存) + Task 2 (迁移) + Task 3 (max_buffer 更新缓存)
- ✅ 字符级 slice（不切碎 UTF-8）：Task 1 沿用字符级
- ✅ 滞回式截断：Task 1
- ✅ maxBufferChars 仅配置变更时重算：Task 1 (loadConfig) + Task 3 (max_buffer)
- ✅ buffer_size 协议：Task 3 (服务端) + Task 7 (客户端)
- ✅ buffer 检测 UI：Task 6 (按钮) + Task 7 (响应展示)
- ✅ 5s 超时：Task 6
- ✅ activeId 同步禁用：Task 6 (openSettingsModal) + Task 6 (switchSession)
- ✅ config 迁移：Task 2
- ✅ AGENTS.md 同步：Task 8
- ✅ 端到端验证：Task 9

**2. 占位符扫描**：
- 无 TBD / TODO / 「稍后实现」
- 所有代码块均含完整可执行代码
- 无「类似 Task N」引用

**3. 类型一致性**：
- `maxBufferChars`（server.js 模块级变量）在 Task 1 / Task 3 一致使用
- `settingsDiv`（前端全局变量）在 Task 6 / Task 6 / Task 7 一致使用
- `settingsRowsInput / settingsColsInput / settingsScrollStepInput / settingsMaxBufferInput / bufferSizeResult / queryBufferSizeBtn`（前端 id）在 Task 6 / Task 7 一致使用
- `bufferSizeResult` 的 `current会话占用: ${usedMB} MB / ${maxMB} MB (${pct}%)` 格式在 Task 6 设置，Task 7 验证显示一致

**4. 边界一致性**：
- Task 2 迁移规则（值 ≥ 1000 视为旧字符数）与 Task 1 启动时的 1 MB = 1,000,000 字符换算口径一致
- Task 6 maxBuffer 范围 1~90 与 Task 1 maxBuffer 范围一致
- Task 6 滚动行数 1~100 与 Task 5 删除原 applyScrollStep 时的 min/max 一致
- Task 6 终端大小 20~200 与 Task 5 删除原 applySize 时的 min/max 一致

**5. 不在范围项**：与 spec 一致，未越界。
