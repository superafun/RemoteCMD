# 最近路径库（Recent Paths）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发送命令时自动记录输入的 Windows 盘符绝对路径，顶部「最近路径」按钮展开下拉，点击路径即复制到剪贴板；并把「关闭终端」按钮移入设置面板改名「关闭当前终端」。

**Architecture:** 前端 `sendInputBar()` 检测首条盘符路径并 `wsSend` 上行增量；后端 `server.js` 去重/置顶/截断10/写盘 `config.json`/广播；前端接收 `recent_paths` 消息更新内存数组并渲染下拉。复用现有 `dropdown-menu` 样式与 `copyToClipboard`/`showToast`，沿用设置项同款 `config.json`+WS 同步链路。

**Tech Stack:** 纯前端（单文件 `public/index.html`，原生 JS + 现有 CSS class）；后端 `server.js`（Node.js `ws` + `fs`）；无新增依赖。

## Global Constraints

- 数据模型：`config.json` 新增 `recentPaths: string[]`，长度 ≤10、元素不重复、index 0 为最新。
- `loadConfig` 兜底 `recentPaths: []`；不做老用户迁移。
- 路径识别正则：`/\b[A-Za-z]:\\[^\s"'`]+/`（仅 Windows 盘符绝对路径，不识别 UNC/不剥引号，一次取第一条）。
- WS 协议：上行 `{ type: 'recent_paths_add', data: <path字符串> }`；下行 `{ type: 'recent_paths', data: string[] }`。
- 服务端处理顺序：去重 → unshift 置顶 → `slice(0, 10)` 截断 → `saveConfig(config)` 写盘 → `broadcast` 全部 OPEN 连接。
- 新连接建立时下发 `recent_paths`（保证刷新/重连立即可见）。
- UI：移除工具栏「关闭终端」按钮；设置弹窗 `modal-actions` 区加「关闭当前终端」(`.btn-danger`，复用 `killCurrent()`)；工具栏原位置加「最近路径」按钮 `#recentPathsBtn`。
- 下拉：复用 `.dropdown-menu` 样式与 `getBoundingClientRect` 定位 + `classList.toggle('open')` + 外部点击关闭逻辑；每条路径是**可点击整行**，点击 = `copyToClipboard(path)` + `showToast('已复制','success')`；无独立复制按钮、无插入输入条功能。
- 下拉宽度紧凑、按内容贴合（无多余横向留白）；空状态显示「暂无记录」。
- **不使用** localStorage / 纯内存变量，必须走 `config.json` + WS 同步。

---

### Task 1: server.js 增加 recentPaths 配置默认值与兜底

**Files:**
- Modify: `server.js` `loadConfig()`（约 L9–L74）

**Interfaces:**
- 消费：无
- 生产：`config.recentPaths` 字段（string[]），供 Task 2/3 读写

- [ ] **Step 1: 在默认对象中加 `recentPaths: []`**

定位 `loadConfig()` 内默认对象（L11–L32），在 `inputBarHideOnBlur: true` 那一行（L31）之后、`return def;`（L34）之前插入一行：

```js
            inputBarHideOnBlur: true,
            recentPaths: []
```

- [ ] **Step 2: 在解析已有 config 后加兜底**

在 `const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));`（约 L36）之后、各字段校验之前，加：

```js
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Array.isArray(cfg.recentPaths)) cfg.recentPaths = [];
```

- [ ] **Step 3: 语法自检**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node -c server.js`
Expected: 无输出（语法通过）

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: config.json 增加 recentPaths 默认字段与兜底"
```

---

### Task 2: server.js 处理 recent_paths_add 消息

**Files:**
- Modify: `server.js` `ws.on('message', ...)` 分支（约 L222–L227，`type === 'kill'` 分支在 L227）

**Interfaces:**
- 消费：`config.recentPaths`、`saveConfig()`（L75–L77）、`broadcast()`（L104–L106）
- 生产：广播 `{ type: 'recent_paths', data: config.recentPaths }`

- [ ] **Step 1: 在 kill 分支后加 recent_paths_add 分支**

在 `else if (type === 'kill' && sessions[id]) sessions[id].pty.kill();`（L227）之后插入：

```js
        else if (type === 'kill' && sessions[id]) sessions[id].pty.kill();
        else if (type === 'recent_paths_add' && typeof data === 'string') {
            const p = data.trim();
            if (p) {
                config.recentPaths = [p, ...config.recentPaths.filter(x => x !== p)].slice(0, 10);
                saveConfig(config);
                broadcast({ type: 'recent_paths', data: config.recentPaths });
            }
        }
```

说明：`[p, ... filter]` 实现「去重 + 置顶」，`slice(0,10)` 截断到 10 条；`saveConfig` 写盘，`broadcast` 推全部 OPEN 连接。`data` 字段名与前端 `wsSend({type:'recent_paths_add', data: ...})` 对应（同文件顶部已 `const { type, id, data } = p;` 解构）。

- [ ] **Step 2: 语法自检**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node -c server.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: server 处理 recent_paths_add，去重置顶截断写盘广播"
```

---

### Task 3: server.js 新连接下发 recent_paths

**Files:**
- Modify: `server.js` `wss.on('connection', ...)` 下发区块（约 L194–L221，`ws.on('message'` 在 L221）

**Interfaces:**
- 消费：`config.recentPaths`
- 生产：首屏即收到 `{ type: 'recent_paths', data: ... }`

- [ ] **Step 1: 在下发设置末尾加 recent_paths**

在 `ws.send(JSON.stringify({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs }));`（约 L220）之后、`ws.on('message', ...)`（约 L221）之前插入：

```js
    ws.send(JSON.stringify({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs }));
    ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));
    ws.on('message', (msg) => {
```

- [ ] **Step 2: 语法自检**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node -c server.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: 新连接下发 recent_paths"
```

---

### Task 4: 前端工具栏按钮 + 关闭终端移入设置面板

**Files:**
- Modify: `public/index.html` 工具栏 `.toolbar`（约 L40–L50）
- Modify: `public/index.html` `openSettingsModal()` 的 `modal-actions`（约 L331–L336）

**Interfaces:**
- 消费：现有 `killCurrent()`（L1072）、`.btn-danger` 样式
- 生产：`#recentPathsBtn` 按钮、`#recentPathsDropdown` 容器（供 Task 5 绑定）

- [ ] **Step 1: 工具栏移除「关闭终端」，加「最近路径」按钮与下拉容器**

将 `.toolbar`（L40–L50）改为：

```html
        <div class="toolbar">
            <button id="sessionSelectBtn"></button>
            <div id="sessionDropdown" class="dropdown-menu"></div>
            <button onclick="renameCurrent()">重命名</button>
            <button onclick="createNew()">新建终端</button>
            <button id="recentPathsBtn">最近路径</button>
            <button id="sizeToggleBtn" onclick="toggleSize()">大</button>
            <button id="selectModeBtn" onclick="toggleSelectMode()">选区模式</button>
            <button id="openSettingsBtn" onclick="openSettingsModal()">设置</button>
            <div id="recentPathsDropdown" class="dropdown-menu"></div>
            <span id="wsStatus"></span>
        </div>
```

变更点：删除原 L45 `<button onclick="killCurrent()">关闭终端</button>`；在「新建终端」后插入 `<button id="recentPathsBtn">最近路径</button>`；在「设置」按钮后、`wsStatus` 前插入 `<div id="recentPathsDropdown" class="dropdown-menu"></div>`。

- [ ] **Step 2: 设置面板加「关闭当前终端」**

在 `modal-actions`（约 L331–L336）的「重启服务器」按钮（L332）之后插入一行：

```javascript
            html += '<div class="modal-actions">';
            html += '<button class="btn-danger" onclick="restartServer()">重启服务器</button>';
            html += '<button class="btn-danger" onclick="killCurrent()">关闭当前终端</button>';
            html += '<button onclick="renameAll()">重命名全部</button>';
            html += '<button onclick="openLogModal()">日志</button>';
            html += '<button onclick="closeSettingsModal()" style="margin-left:auto;">关闭</button>';
            html += '</div>';
```

说明：复用 `killCurrent()`，后端 kill 逻辑不动；`.btn-danger` 与「重启服务器」风格一致。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: 工具栏加最近路径按钮，关闭终端移入设置面板"
```

---

### Task 5: 前端下拉状态、渲染与开关逻辑

**Files:**
- Modify: `public/index.html`（在 `activeId` 声明附近，约 L74 之后加状态变量；在脚本适当位置加函数；在 `<style>` 的 `.dropdown-menu` 样式附近加 CSS）

**Interfaces:**
- 消费：`copyToClipboard()`（L1119）、`showToast()`（L1104）、`document.getElementById('recentPathsBtn'/'recentPathsDropdown')`
- 生产：`recentPaths`（数组，供 Task 6/7 读写）、`renderRecentPathsDropdown()`（供 Task 7 调用）

- [ ] **Step 1: 加状态变量**

在 `activeId` 相关声明（约 L74）附近加：

```js
        let recentPaths = [];
```

- [ ] **Step 2: 加渲染与开关函数**

在 `killCurrent()`（约 L1072）之前或附近加：

```js
        // 渲染「最近路径」下拉内容
        function renderRecentPathsDropdown() {
            const dd = document.getElementById('recentPathsDropdown');
            dd.innerHTML = '';
            if (!recentPaths.length) {
                const empty = document.createElement('div');
                empty.className = 'dropdown-empty';
                empty.textContent = '暂无记录';
                dd.appendChild(empty);
                return;
            }
            recentPaths.forEach(p => {
                const item = document.createElement('div');
                item.className = 'recent-path-item';
                item.textContent = p;   // 用 textContent，避免路径特殊字符破坏 DOM
                item.addEventListener('click', () => {
                    copyToClipboard(p);
                    showToast('已复制', 'success');
                    dd.classList.remove('open');
                });
                dd.appendChild(item);
            });
        }

        // 「最近路径」按钮：定位 + 展开/收起
        document.getElementById('recentPathsBtn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const dd = document.getElementById('recentPathsDropdown');
            const rect = btn.getBoundingClientRect();
            dd.style.top = rect.bottom + 'px';
            dd.style.left = rect.left + 'px';
            dd.style.minWidth = Math.max(rect.width, 200) + 'px';
            renderRecentPathsDropdown();
            dd.classList.toggle('open');
        });
        // 点击下拉外部关闭（复用 sessionDropdown 同款 document 监听模式）
        document.addEventListener('click', (e) => {
            const btn = document.getElementById('recentPathsBtn');
            const dd = document.getElementById('recentPathsDropdown');
            if (!btn.contains(e.target) && !dd.contains(e.target)) {
                dd.classList.remove('open');
            }
        });
```

- [ ] **Step 3: 加紧凑样式**

在 `<style>` 中 `.dropdown-menu` 相关规则附近加：

```css
        .recent-path-item {
            padding: 6px 10px;
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 360px;
        }
        .recent-path-item:hover { background: rgba(255, 255, 255, 0.08); }
        .dropdown-empty { padding: 6px 10px; color: #888; white-space: nowrap; }
```

说明：宽度由 JS 设 `minWidth`（贴合按钮，至少 200px），路径过长时 `max-width:360px` + 省略号，保证紧凑无多余留白。

- [ ] **Step 4: 提交**

```bash
git add public/index.html
git commit -m "feat: 最近路径下拉渲染、开关与紧凑样式"
```

---

### Task 6: 前端发送时检测路径并上报

**Files:**
- Modify: `public/index.html` `sendInputBar()`（约 L1396–L1409）

**Interfaces:**
- 消费：`wsSend()`（L1091）、正则 `/\b[A-Za-z]:\\[^\s"'`]+/`
- 生产：`wsSend({ type: 'recent_paths_add', data: <path> })`

- [ ] **Step 1: 在取到文本后插入检测**

在 `sendInputBar()` 第一行 `const t = inputBarText.value.replace(/\n+$/, '');`（L1397）之后插入：

```js
        async function sendInputBar() {
            const t = inputBarText.value.replace(/\n+$/, '');   // 去末尾换行，避免多发空行
            const pathMatch = t.match(/\b[A-Za-z]:\\[^\s"'`]+/); // 仅取第一条盘符绝对路径
            if (pathMatch) wsSend({ type: 'recent_paths_add', data: pathMatch[0] });
            if (!t) { return; }                                  // 空内容：不发送、不关闭（回车发送语义）
```

其余 sendInputBar 代码保持不变。说明：检测在 `clearInputBar()` 之前、发送之前进行，此时 `t` 为干净文本。

- [ ] **Step 2: 提交**

```bash
git add public/index.html
git commit -m "feat: 发送时检测首条盘符路径并上报 recent_paths_add"
```

---

### Task 7: 前端接收 recent_paths 消息

**Files:**
- Modify: `public/index.html` `ws.onmessage`（约 L729–L925，函数体以 L925 `};` 结束）

**Interfaces:**
- 消费：`recentPaths`（Task 5 状态）、`renderRecentPathsDropdown()`（Task 5）
- 生产：更新 `recentPaths` 并重渲染

- [ ] **Step 1: 在最后一个分支后加 recent_paths 分支**

在最后一个分支 `} else if (msg.type === 'buffer_size') { ... }`（约 L916–L924）之后、函数结束 `};`（约 L925）之前插入：

```js
        } else if (msg.type === 'recent_paths') {
            recentPaths = msg.data || [];
            renderRecentPathsDropdown();
        }
```

注意：前端接收处理函数用变量名 `msg`（非 `p`），字段为 `msg.data`；`recent_paths` 携带完整数组。

- [ ] **Step 2: 提交**

```bash
git add public/index.html
git commit -m "feat: 前端接收 recent_paths 广播并更新下拉"
```

---

### Task 8: 验证

**Files:** 无新增

**Interfaces:** 依赖 Task 1–7 全部落地

- [ ] **Step 1: 后端语法**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node -c server.js`
Expected: 无输出

- [ ] **Step 2: 手动/Playwright 功能验证（需启动服务后在浏览器操作）**

逐项确认：
1. 发送 `cd C:\Users\fmy3` → 点「最近路径」出现该路径且置顶。
2. 发送 `copy D:\a E:\b` → 只记录第一条 `D:\a`。
3. 发送无路径命令（如 `ls`）→ 不记录。
4. 再次发送已存在路径 → 该路径移到最前、不重复。
5. 累计发送 >10 条不同路径 → 只保留最新 10 条。
6. 点击某条路径 → 剪贴板内容为该路径 + Toast「已复制」。
7. 多端：A 端发送后 B 端「最近路径」即时出现。
8. 刷新页面 / 重启服务器后列表仍在（来自 config.json）。
9. 设置面板出现「关闭当前终端」(.btn-danger)，点击效果与原工具栏「关闭终端」一致；工具栏原位置现为「最近路径」按钮。

- [ ] **Step 3: 提交验证记录（如有截图/日志）**

（可选）将验证截图放入仓库并提交；无则跳过。
