# 按住滚动间隔拆分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `scrollInterval` 单项配置拆成 `scrollIntervalTerminal`（终端 SGR 滚轮）+ `scrollIntervalPage`（页面 xterm 滚视图）两个独立配置，对应两条新 WebSocket 消息，hard break 旧协议。

**Architecture:** 后端改 `loadConfig` 默认值 + 连接下发 + 消息处理 3 处；前端改全局变量 + setupHoldScroll 签名 + 设置弹窗 + ws.onmessage 4 处；AGENTS.md 注意事项 24 同步更新。共 7 个独立 commit。

**Tech Stack:** Node.js + Express + ws (server.js), 原生 HTML/JS (public/index.html), 无测试框架（项目无 test runner 配置），手动验证。

**Spec:** [docs/superpowers/specs/2026-07-01-scroll-interval-split-design.md](../specs/2026-07-01-scroll-interval-split-design.md)

---

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `server.js` | `loadConfig` 默认对象新增 `scrollIntervalTerminal/scrollIntervalPage`；`loadConfig` 兜底分支新增两个 if；`wss.on('connection')` 删除 `scroll_interval` 下发、新增 2 条；`ws.on('message')` 删除 `scroll_interval` 分支、新增 2 个 |
| `public/index.html` | 删除 `let scrollInterval = 100;`；新增 2 个 `let`；`setupHoldScroll` 签名扩展 + 4 个调用点更新；设置弹窗 HTML 替换 1 行为 2 行；弹窗同步 2 个值；`applySettingsScrollInterval` 替换为 2 个新函数；ws.onmessage 删除 1 个分支 + 新增 2 个 |
| `AGENTS.md` | 注意事项 24 改写（描述新字段名 + 修正"周期锁定"行为） |

---

### Task 1: 后端 `loadConfig` 默认对象新增 2 个字段

**Files:**
- Modify: `server.js:11-19`

- [ ] **Step 1: 编辑 `loadConfig` 默认对象**

在 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) 第 11-19 行的 `def` 对象中，将 `scrollInterval: 100,` 替换为：

```javascript
            scrollIntervalTerminal: 100,
            scrollIntervalPage: 100,
```

- [ ] **Step 2: 验证修改**

`grep -n "scrollInterval" server.js` 应输出两行 `scrollIntervalTerminal: 100,` / `scrollIntervalPage: 100,`（不再有 `scrollInterval: 100,`）。

- [ ] **Step 3: 提交**

```bash
git add server.js
git commit -m "feat: scrollInterval 配置拆分为 Terminal 和 Page 两个独立字段"
```

---

### Task 2: 后端 `loadConfig` 兜底分支新增 2 个 if

**Files:**
- Modify: `server.js:38-46`（在 `if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;` 之后新增）

- [ ] **Step 1: 在兜底分支新增 2 个 if**

在 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) 的 `if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;` 之后（`return cfg;` 之前），新增：

```javascript
    if (typeof cfg.scrollIntervalTerminal !== 'number' || cfg.scrollIntervalTerminal < 1 || cfg.scrollIntervalTerminal > 1000) cfg.scrollIntervalTerminal = 100;
    if (typeof cfg.scrollIntervalPage !== 'number' || cfg.scrollIntervalPage < 1 || cfg.scrollIntervalPage > 1000) cfg.scrollIntervalPage = 100;
```

- [ ] **Step 2: 验证修改**

`grep -n "scrollInterval" server.js` 应输出 4 行（2 个默认值 + 2 个兜底 if）。

- [ ] **Step 3: 提交**

```bash
git add server.js
git commit -m "feat: loadConfig 兜底分支支持 scrollIntervalTerminal/Page 缺失值"
```

---

### Task 3: 后端 `wss.on('connection')` 替换下发消息

**Files:**
- Modify: `server.js:140`（替换 `ws.send(JSON.stringify({ type: 'scroll_interval', data: config.scrollInterval }));`）

- [ ] **Step 1: 替换单条消息为 2 条**

将 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) 第 140 行：

```javascript
    ws.send(JSON.stringify({ type: 'scroll_interval', data: config.scrollInterval }));
```

替换为：

```javascript
    ws.send(JSON.stringify({ type: 'scroll_interval_terminal', data: config.scrollIntervalTerminal }));
    ws.send(JSON.stringify({ type: 'scroll_interval_page', data: config.scrollIntervalPage }));
```

- [ ] **Step 2: 验证修改**

`grep -n "scroll_interval" server.js` 应输出 3 处引用（connection 下发 2 处 + message handler 2 处，共 4 处；实际为 4 个匹配）。不应再有 `scroll_interval'` 单独字符串（应都是 `scroll_interval_terminal'` 或 `scroll_interval_page'`）。

- [ ] **Step 3: 提交**

```bash
git add server.js
git commit -m "refactor: 连接时下发拆分为 scroll_interval_terminal/page 两条消息"
```

---

### Task 4: 后端 `ws.on('message')` 替换 scroll_interval 分支

**Files:**
- Modify: `server.js:211-215`（删除 `else if (type === 'scroll_interval')` 分支，新增 2 个）

- [ ] **Step 1: 删除旧分支**

在 [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) 中删除第 211-215 行：

```javascript
        else if (type === 'scroll_interval') {
            config.scrollInterval = data;
            broadcast({ type: 'scroll_interval', data: config.scrollInterval });
            saveConfig(config);
        }
```

- [ ] **Step 2: 新增 2 个分支**

在删除的旧分支原位置（`else if (type === 'hot_keys')` 之前），新增：

```javascript
        else if (type === 'scroll_interval_terminal') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 1000) return;
            config.scrollIntervalTerminal = v;
            broadcast({ type: 'scroll_interval_terminal', data: config.scrollIntervalTerminal });
            saveConfig(config);
        }
        else if (type === 'scroll_interval_page') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 1000) return;
            config.scrollIntervalPage = v;
            broadcast({ type: 'scroll_interval_page', data: config.scrollIntervalPage });
            saveConfig(config);
        }
```

- [ ] **Step 3: 验证修改**

`grep -n "scroll_interval" server.js` 应只输出 `scroll_interval_terminal` 和 `scroll_interval_page` 相关行，不应有单独 `scroll_interval'`。

- [ ] **Step 4: 提交**

```bash
git add server.js
git commit -m "refactor: 消息处理 split scroll_interval_terminal/page 两个分支"
```

---

### Task 5: 前端 globals + setupHoldScroll 改造

**Files:**
- Modify: `public/index.html:46`（替换 `let scrollInterval = 100;`）
- Modify: `public/index.html:530-545`（`setupHoldScroll` 签名 + 4 个调用点）

- [ ] **Step 1: 替换全局变量**

将 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 46 行：

```javascript
        let scrollInterval = 100;
```

替换为：

```javascript
        let scrollIntervalTerminal = 100;
        let scrollIntervalPage = 100;
```

- [ ] **Step 2: 替换 setupHoldScroll 函数**

将 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 530-545 行的 `setupHoldScroll` 函数 + 4 个调用，替换为：

```javascript
        // 按住连续滚动（pointerdown 立即触发，pointerup/pointerleave 停止）
        // setInterval 创建时调用 intervalGetter() 读一次周期，运行期间不变（需释放+再次按住才按新值）
        function setupHoldScroll(btnId, fn, intervalGetter) {
            const btn = document.getElementById(btnId);
            let timer = null;
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                fn();
                timer = setInterval(fn, intervalGetter());
            });
            const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
            btn.addEventListener('pointerup', stop);
            btn.addEventListener('pointerleave', stop);
        }
        setupHoldScroll('scrollUpBtn', scrollUp, () => scrollIntervalTerminal);
        setupHoldScroll('scrollDownBtn', scrollDown, () => scrollIntervalTerminal);
        setupHoldScroll('scrollXtermUpBtn', scrollXtermUp, () => scrollIntervalPage);
        setupHoldScroll('scrollXtermDownBtn', scrollXtermDown, () => scrollIntervalPage);
```

- [ ] **Step 3: 验证修改**

`grep -n "scrollInterval\|setupHoldScroll" public/index.html` 应输出：
- `let scrollIntervalTerminal = 100;`
- `let scrollIntervalPage = 100;`
- 4 个 `setupHoldScroll('...', xxx, () => scrollInterval...)` 调用
- 不应再有 `let scrollInterval = 100;`

- [ ] **Step 4: 提交**

```bash
git add public/index.html
git commit -m "refactor: 前端 globals 拆分为 Terminal/Page；setupHoldScroll 加 getter 参数"
```

---

### Task 6: 前端设置弹窗 HTML 替换 1 行为 2 行

**Files:**
- Modify: `public/index.html:128-131`（设置弹窗中"按住滚动间隔"一行替换为 2 行）

- [ ] **Step 1: 替换 HTML 片段**

将 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 128-131 行：

```javascript
            // 按住滚动间隔 (ms)
            html += '<div class="modal-row">';
            html += '按住滚动间隔 (ms) <input type="number" id="settingsScrollIntervalInput" min="1" max="1000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-scrollInterval" onclick="applySettingsScrollInterval()">应用</button>';
            html += '</div>';
```

替换为：

```javascript
            // 按住终端滚动间隔 (ms)
            html += '<div class="modal-row">';
            html += '按住终端滚动间隔 (ms) <input type="number" id="settingsScrollIntervalTerminalInput" min="1" max="1000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-scrollIntervalTerminal" onclick="applySettingsScrollIntervalTerminal()">应用</button>';
            html += '</div>';

            // 按住页面滚动间隔 (ms)
            html += '<div class="modal-row">';
            html += '按住页面滚动间隔 (ms) <input type="number" id="settingsScrollIntervalPageInput" min="1" max="1000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-scrollIntervalPage" onclick="applySettingsScrollIntervalPage()">应用</button>';
            html += '</div>';
```

- [ ] **Step 2: 验证修改**

`grep -n "ScrollInterval" public/index.html` 应不再有 `settingsScrollIntervalInput` / `btn-apply-scrollInterval` / `applySettingsScrollInterval()` 的单独字符串（应都是带 Terminal/Page 后缀的版本）。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: 设置弹窗按滚动间隔拆分为 终端/页面 两项"
```

---

### Task 7: 前端弹窗同步值 + applySettings 函数替换

**Files:**
- Modify: `public/index.html:174`（弹窗打开时同步 2 个值）
- Modify: `public/index.html:212-221`（删除 `applySettingsScrollInterval` 并新增 2 个函数）

- [ ] **Step 1: 替换弹窗同步值的 1 行**

将 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 174 行：

```javascript
            document.getElementById('settingsScrollIntervalInput').value = scrollInterval;
```

替换为：

```javascript
            document.getElementById('settingsScrollIntervalTerminalInput').value = scrollIntervalTerminal;
            document.getElementById('settingsScrollIntervalPageInput').value = scrollIntervalPage;
```

- [ ] **Step 2: 替换 applySettingsScrollInterval 函数**

将 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 212-221 行的 `applySettingsScrollInterval` 函数：

```javascript
        function applySettingsScrollInterval() {
            const v = parseInt(document.getElementById('settingsScrollIntervalInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 1000) {
                // 客户端不立即修改 scrollInterval：等服务端广播回来再更新（避免 ws 失败时本地与服务端不一致）
                wsSend({ type: 'scroll_interval', data: v });
                fbBtn('btn-apply-scrollInterval', true);
            } else {
                fbBtn('btn-apply-scrollInterval', false);
            }
        }
```

替换为：

```javascript
        function applySettingsScrollIntervalTerminal() {
            const v = parseInt(document.getElementById('settingsScrollIntervalTerminalInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 1000) {
                // 服务端权威：只发不发本地状态，收到 broadcast 后再更新
                wsSend({ type: 'scroll_interval_terminal', data: v });
                fbBtn('btn-apply-scrollIntervalTerminal', true);
            } else {
                fbBtn('btn-apply-scrollIntervalTerminal', false);
            }
        }

        function applySettingsScrollIntervalPage() {
            const v = parseInt(document.getElementById('settingsScrollIntervalPageInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 1000) {
                wsSend({ type: 'scroll_interval_page', data: v });
                fbBtn('btn-apply-scrollIntervalPage', true);
            } else {
                fbBtn('btn-apply-scrollIntervalPage', false);
            }
        }
```

- [ ] **Step 3: 验证修改**

`grep -n "applySettingsScrollInterval\|settingsScrollInterval" public/index.html` 应只输出带 Terminal/Page 后缀的引用。

- [ ] **Step 4: 提交**

```bash
git add public/index.html
git commit -m "feat: 弹窗同步值 + applySettings 拆分为 Terminal/Page 两个函数"
```

---

### Task 8: 前端 ws.onmessage 替换 scroll_interval 分支

**Files:**
- Modify: `public/index.html:471-473`（删除 `else if (msg.type === 'scroll_interval')` 分支，新增 2 个）

- [ ] **Step 1: 替换 ws.onmessage 分支**

将 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 第 471-473 行：

```javascript
                    } else if (msg.type === 'scroll_interval') {
                        scrollInterval = msg.data;
                        addFrontendLog('按住滚动间隔同步为 ' + scrollInterval + ' ms');
                    }
```

替换为：

```javascript
                    } else if (msg.type === 'scroll_interval_terminal') {
                        scrollIntervalTerminal = msg.data;
                        addFrontendLog('终端按住滚动间隔同步为 ' + scrollIntervalTerminal + ' ms');
                    } else if (msg.type === 'scroll_interval_page') {
                        scrollIntervalPage = msg.data;
                        addFrontendLog('页面按住滚动间隔同步为 ' + scrollIntervalPage + ' ms');
                    }
```

- [ ] **Step 2: 验证修改**

`grep -n "scroll_interval" public/index.html` 应只输出 `scroll_interval_terminal` / `scroll_interval_page` 相关行，不应有单独 `scroll_interval'`。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "refactor: ws.onmessage 拆分为 scroll_interval_terminal/page 两个分支"
```

---

### Task 9: 更新 AGENTS.md 注意事项 24

**Files:**
- Modify: `AGENTS.md`（注意事项 24 改写）

- [ ] **Step 1: 定位注意事项 24**

在 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 中找到注意事项 24：

```markdown
24. **按住滚动间隔可配置（2026-06-30）**：按住上滑/下滑按钮时连续触发的间隔毫秒数改为 config.json 可配置项。
    - 字段名：`scrollInterval`，默认 100ms，范围 1-1000ms
    - WebSocket 消息类型：`scroll_interval`（双向同步）
    - 前端 `setupHoldScroll` 每次 `setInterval` 触发时重新读取全局 `scrollInterval` 变量
    - 设置弹窗中「按住滚动间隔 (ms)」输入框，step=10，min=1
```

- [ ] **Step 2: 替换注意事项 24**

将上述内容替换为：

```markdown
24. **按住滚动间隔拆分为终端/页面两项（2026-07-01）**：原 `scrollInterval` 单项配置拆成两个独立字段。Hard break，无旧版本兼容。
    - 字段名：`scrollIntervalTerminal`（终端 SGR 滚轮按钮，默认 100ms）+ `scrollIntervalPage`（页面 xterm 滚视图按钮，默认 100ms），范围 1-1000ms
    - WebSocket 消息类型：`scroll_interval_terminal`（双向同步）+ `scroll_interval_page`（双向同步）
    - 前端 `setupHoldScroll` 签名扩展为 `(btnId, fn, intervalGetter)`：4 个按钮按类型传入对应 getter（终端传 `() => scrollIntervalTerminal`，页面传 `() => scrollIntervalPage`）
    - **周期锁定语义**：`setInterval` 创建时调用 `intervalGetter()` 读一次周期，运行期间不变；按住期间改设置不会影响当前定时器，需释放并再次按住才按新值生效
    - 设置弹窗中「按住终端滚动间隔 (ms)」+「按住页面滚动间隔 (ms)」两个输入框，step=10，min=1
```

- [ ] **Step 3: 验证修改**

`grep -n "scrollInterval\|scroll_interval" AGENTS.md` 应只输出 `scrollIntervalTerminal` / `scrollIntervalPage` / `scroll_interval_terminal` / `scroll_interval_page` 相关行，不再有单独 `scrollInterval`（除了"`scrollInterval` 单项配置"这种描述性的字符串）。

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md
git commit -m "docs: 注意事项 24 改写为 scrollIntervalTerminal/Page 拆分 + 周期锁定语义"
```

---

### Task 10: 端到端手动验证

**Files:** 无（验证任务）

- [ ] **Step 1: 重启服务器**

```bash
npm run restart
```

- [ ] **Step 2: 验证首连下发**

浏览器打开 http://localhost:65433 ，打开 F12 console，查看 WebSocket 消息。预期看到：
- `{type: 'scroll_interval_terminal', data: 100}`
- `{type: 'scroll_interval_page', data: 100}`
- 不应有 `scroll_interval`

- [ ] **Step 3: 验证设置弹窗**

点「设置」按钮，弹窗中应有「按住终端滚动间隔 (ms)」+「按住页面滚动间隔 (ms)」两项，不再有「按住滚动间隔 (ms)」一项。两项默认值都应为 100。

- [ ] **Step 4: 验证改终端间隔**

弹窗中把终端间隔改成 50，点应用。预期：
- console 看到 `{type: 'scroll_interval_terminal', data: 50}` 双向消息
- 弹窗「应用」按钮显示「✓已应用」1.5 秒后恢复
- 「上滑终端 / 下滑终端」按住周期=50ms
- 「上滑页面 / 下滑页面」保持 100ms 不变

- [ ] **Step 5: 验证改页面间隔**

弹窗中把页面间隔改成 200，点应用。预期：
- console 看到 `{type: 'scroll_interval_page', data: 200}` 双向消息
- 「上滑页面 / 下滑页面」按住周期=200ms
- 「上滑终端 / 下滑终端」保持 50ms 不变

- [ ] **Step 6: 验证非法值**

弹窗中把终端间隔改成 0 或 1001，点应用。预期：
- 「应用」按钮显示「✗无效」
- 服务端无变化
- console 看不到 `scroll_interval_terminal` 双向消息

- [ ] **Step 7: 验证持久化**

`npm run restart`，刷新浏览器。预期：
- 终端间隔=50、页面间隔=200 都保留

- [ ] **Step 8: 验证多客户端广播**

开两个浏览器窗口（A 和 B）。A 改终端间隔为 30 并应用。预期：
- B 收到 `{type: 'scroll_interval_terminal', data: 30}` 消息
- B 不收到 `scroll_interval_page` 消息

- [ ] **Step 9: 验证旧消息被忽略**

F12 console 执行：

```javascript
ws.send(JSON.stringify({type:'scroll_interval', data: 50}))
```

预期：服务端无反应，前端无变化。

- [ ] **Step 10: 验证 config.json 新字段**

打开 `config.json`，应看到 `scrollIntervalTerminal: 50` + `scrollIntervalPage: 200`，不应有 `scrollInterval`（除非你之前留了，可以手动删除）。

---

## Self-Review

**1. Spec coverage:**
- ✅ 协议变更（删除/新增）— Task 1-4（后端）+ Task 5-8（前端）
- ✅ 数据模型 — Task 1-2（后端 defaults/兜底）+ Task 5（前端 globals）
- ✅ UI 变更（设置弹窗）— Task 6-7
- ✅ setupHoldScroll 改造 — Task 5
- ✅ 服务端权威模式 — Task 7 applySettings 函数内注释
- ✅ 错误处理（1-1000 整数校验）— Task 4（服务端校验）+ Task 7（前端 fbBtn）
- ✅ 性能影响分析 — 文档已记录，代码层面无额外措施
- ✅ AGENTS.md 注意事项 24 更新 — Task 9
- ✅ 端到端验证 — Task 10

**2. Placeholder scan:**
- 全部步骤都包含具体代码或命令，无 TBD/TODO。

**3. Type consistency:**
- 全局变量名一致：`scrollIntervalTerminal` / `scrollIntervalPage`（server.js + index.html）
- WS 消息类型一致：`scroll_interval_terminal` / `scroll_interval_page`（server.js + index.html）
- DOM ID 一致：`settingsScrollIntervalTerminalInput` / `settingsScrollIntervalPageInput` / `btn-apply-scrollIntervalTerminal` / `btn-apply-scrollIntervalPage`（HTML + JS）
- 函数名一致：`applySettingsScrollIntervalTerminal` / `applySettingsScrollIntervalPage`（HTML）
- setupHoldScroll 签名 `(btnId, fn, intervalGetter)` 一致（HTML 4 处调用 + 函数定义）
- 校验范围一致：1-1000（HTML 弹窗 min/max + JS parseInt 校验 + server.js 校验）
