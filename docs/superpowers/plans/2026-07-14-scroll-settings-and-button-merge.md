# 滑动手感设置 + 按钮合并 + 显隐 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把触摸滑动阈值/判定阈值做成多端同步设置、把 4 个滚动按钮合并为 2 个、并新增滚动按钮显隐的多端同步设置。

**Architecture:** 服务端在 `config.json` 加 3 个字段，照抄现有 `scroll_interval_*` 的设置链路（loadConfig 兜底 + on-connection 下发 + message handler 校验/落盘/广播）；前端把原 `const` 阈值改为可变全局变量、合并按钮、加显隐 class 与设置弹窗行。所有设置改完实时广播所有客户端。

**Tech Stack:** Node.js + Express 5 + ws（server.js，CommonJS）、原生 JS 内联前端（public/index.html）、CSS（public/styles.css）。无打包工具、无测试框架。

## Global Constraints

- **多端同步**：所有新设置走"服务端权威 + 广播所有客户端 + 落盘 config.json + 连接时下发"全链路，与现有 `scroll_interval_*` 完全一致（AGENTS.md 注意事项 27/28）。
- **每次改动必须立即 `git commit`**，禁止 `git add -A`；一个独立变更一个 commit。
- **`wsSend` 唯一出口**：所有 `ws.send()` 必须走 `wsSend`（本计划 apply 函数已用 `wsSend`）。
- **服务端权威**：apply 函数只 `wsSend`，不本地改状态；本地状态由 `ws.onmessage` 接收侧更新（AGENTS.md 注意事项 28）。
- **新增 ws 消息必须配套前端日志**（接收侧 `addFrontendLog`），input/data 类高频消息除外（AGENTS.md 注意事项 27）。
- **单一用户，无老用户兼容**：`config.json` 直接写新字段；`loadConfig` 仅默认值兜底，不做迁移逻辑。
- **改了 `server.js` 必须 PM2 重启服务**（`npm run restart` 或设置弹窗"重启服务器"）后端才生效；前端刷新即加载新前端（AGENTS.md 开发工作流）。
- **命名/范围**：message type 用 `swipe_threshold` / `swipe_classify` / `show_scroll_buttons`；按钮 `▲上滑`=`scrollUpBtn`、`▼下滑`=`scrollDownBtn`、`▽到底页面`=`scrollBottomBtn` 保持不变。

---

### Task 1: 服务端配置链路（config.json + server.js）

**Files:**
- Modify: `config.json`（新增 3 个字段）
- Modify: `server.js:48`（loadConfig 兜底，在 `scrollIntervalPage` 兜底之后）
- Modify: `server.js:160`（on-connection 下发，在 `scroll_interval_page` 发送之后）
- Modify: `server.js:240`（message switch，在 `scroll_interval_page` handler 之后）

**Interfaces:**
- Consumes: `config` 对象、`broadcast()`、`saveConfig()`（均已存在）
- Produces: 新配置字段 `config.swipeThreshold`(24) / `config.swipeClassify`(10) / `config.showScrollButtons`(true)；新 message type `swipe_threshold` / `swipe_classify` / `show_scroll_buttons`（C→S 设置 + S→C 广播）

- [ ] **Step 1: 在 `config.json` 末尾新增 3 个字段**（在 `"scrollIntervalPage": 20` 那行之后，`}` 之前）：
```json
  "scrollIntervalPage": 20,
  "swipeThreshold": 24,
  "swipeClassify": 10,
  "showScrollButtons": true
```
（注意 JSON 逗号：上一行 `scrollIntervalPage` 末尾加逗号，新字段间逗号正确，最后一行 `showScrollButtons` 后无逗号，再闭合 `}`。）

- [ ] **Step 2: `server.js` `loadConfig` 加默认值兜底**（在现有 `cfg.scrollIntervalPage` 兜底行之后插入）：
```js
    if (typeof cfg.swipeThreshold !== 'number' || cfg.swipeThreshold < 1 || cfg.swipeThreshold > 200) cfg.swipeThreshold = 24;
    if (typeof cfg.swipeClassify !== 'number' || cfg.swipeClassify < 1 || cfg.swipeClassify > 100) cfg.swipeClassify = 10;
    if (typeof cfg.showScrollButtons !== 'boolean') cfg.showScrollButtons = true;
```

- [ ] **Step 3: `server.js` on-connection 下发**（在现有 `ws.send(... scroll_interval_page ...)` 之后插入）：
```js
    ws.send(JSON.stringify({ type: 'swipe_threshold', data: config.swipeThreshold }));
    ws.send(JSON.stringify({ type: 'swipe_classify', data: config.swipeClassify }));
    ws.send(JSON.stringify({ type: 'show_scroll_buttons', data: config.showScrollButtons }));
```

- [ ] **Step 4: `server.js` message switch 加 3 个 handler**（在现有 `scroll_interval_page` handler 的 `}` 之后、`max_buffer` handler 之前插入）：
```js
        else if (type === 'swipe_threshold') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 200) return;
            config.swipeThreshold = v;
            broadcast({ type: 'swipe_threshold', data: config.swipeThreshold });
            saveConfig(config);
        }
        else if (type === 'swipe_classify') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 100) return;
            config.swipeClassify = v;
            broadcast({ type: 'swipe_classify', data: config.swipeClassify });
            saveConfig(config);
        }
        else if (type === 'show_scroll_buttons') {
            if (typeof data !== 'boolean') return;
            config.showScrollButtons = data;
            broadcast({ type: 'show_scroll_buttons', data: config.showScrollButtons });
            saveConfig(config);
        }
```

- [ ] **Step 5: 重启服务并验证连接下发**
```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD" && npm run restart
```
然后用一段 node 脚本连接 WS，确认收到 3 条新消息：
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:<端口>/cmd/');
const seen = [];
ws.on('message', m => { const p = JSON.parse(m); if (['swipe_threshold','swipe_classify','show_scroll_buttons'].includes(p.type)) seen.push(p.type+'='+JSON.stringify(p.data)); });
setTimeout(() => { console.log('RECEIVED:', seen.join('  ')); ws.close(); }, 1500);
"
```
预期输出包含 `swipe_threshold=24  swipe_classify=10  show_scroll_buttons=true`。

- [ ] **Step 6: 提交**
```bash
git add server.js config.json
git commit -m "feat: 服务端新增滑动阈值/判定/按钮显隐配置链路"
```

---

### Task 2: 前端全局变量 + 触摸块改用变量

**Files:**
- Modify: `public/index.html:80`（顶部全局变量，在 `scrollIntervalPage` 之后）
- Modify: `public/index.html:884-885`（删除 `const SWIPE_THRESHOLD/SWIPE_CLASSIFY`）
- Modify: `public/index.html:918,930,931`（`SWIPE_CLASSIFY`/`SWIPE_THRESHOLD` 替换为小写变量）

**Interfaces:**
- Consumes: 无（本任务独立）
- Produces: 全局 `let swipeThreshold` / `let swipeClassify`（供 Task 3/4/5 及触摸逻辑读取）

- [ ] **Step 1: 顶部新增全局变量**（在 `let scrollIntervalPage = 100;` 之后插入）：
```js
        let swipeThreshold = 24;   // 滑动滚动阈值(px)，设置可改、实时生效
        let swipeClassify  = 10;   // 滑动判定阈值(px)，设置可改、实时生效
        let showScrollButtons = true;
```

- [ ] **Step 2: 删除触摸块里的 const 声明**
找到：
```js
        const SWIPE_THRESHOLD = 24;   // 每累计多少 px 触发一次滚动，真机调
        const SWIPE_CLASSIFY  = 10;   // 超过此位移且纵向占优才判定为滚动
```
删除这两行（变量改由顶部全局 `let` 提供）。

- [ ] **Step 3: 替换触摸逻辑里的常量引用**
`onTouchScrollStart` 内：
```js
                if (Math.abs(dy) > SWIPE_CLASSIFY && Math.abs(dy) > Math.abs(dx)) {
```
改为：
```js
                if (Math.abs(dy) > swipeClassify && Math.abs(dy) > Math.abs(dx)) {
```
`onTouchScrollMove` 内：
```js
            while (swipeAccum >= SWIPE_THRESHOLD)  { smartScroll(-1); swipeAccum -= SWIPE_THRESHOLD; }  // 手指下滑 → 看更早
            while (swipeAccum <= -SWIPE_THRESHOLD) { smartScroll(1);  swipeAccum += SWIPE_THRESHOLD; }  // 手指上滑 → 看更新
```
改为：
```js
            while (swipeAccum >= swipeThreshold)  { smartScroll(-1); swipeAccum -= swipeThreshold; }  // 手指下滑 → 看更早
            while (swipeAccum <= -swipeThreshold) { smartScroll(1);  swipeAccum += swipeThreshold; }  // 手指上滑 → 看更新
```

- [ ] **Step 4: 语法自检 + 桌面加载确认**
抽取内联脚本 `node --check`（同上次方法）确认无语法错误；刷新网页（连现成/重启后服务）确认控制台无报错、`swipeThreshold`/`swipeClassify` 为 24/10。

- [ ] **Step 5: 提交**
```bash
git add public/index.html
git commit -m "refactor: 滑动阈值/判定改为可变全局变量"
```

---

### Task 3: 合并滚动按钮（4→2）

**Files:**
- Modify: `public/index.html:61-66`（`#scrollGroup` 内 4 按钮→2 按钮 + 保留到底）
- Modify: `public/index.html:701-704`（`setupHoldScroll` 绑定改为 2 个 + 新增 `getScrollInterval`）

**Interfaces:**
- Consumes: `smartScroll(dir)`（已实现）、`scrollIntervalTerminal`/`scrollIntervalPage`（全局）、`sessions`/`activeId`（全局）
- Produces: `getScrollInterval()`（供本任务绑定；Task 5 不需要，但保持函数存在）

- [ ] **Step 1: 改 `#scrollGroup` DOM**（原 4 个按钮替换为 2 个，保留到底页面）：
```html
        <div id="scrollGroup" style="display:flex;flex-shrink:0;margin-left:auto;">
            <button id="scrollUpBtn">▲上滑</button>
            <button id="scrollDownBtn">▼下滑</button>
            <button id="scrollBottomBtn">▽到底页面</button>
        </div>
```

- [ ] **Step 2: 改 `setupHoldScroll` 绑定**（原 4 行改为 2 行 + 新增 `getScrollInterval`）：
```js
        function getScrollInterval() {
            const s = sessions.get(activeId);
            if (s && s.term.modes.mouseTrackingMode !== 'none') return scrollIntervalTerminal;  // TUI：smartScroll 发 SGR
            return scrollIntervalPage;  // 普通 CLI：smartScroll 滚视口
        }
        setupHoldScroll('scrollUpBtn',   () => smartScroll(-1), getScrollInterval);
        setupHoldScroll('scrollDownBtn', () => smartScroll(1),  getScrollInterval);
```

- [ ] **Step 3: 确认 `scrollBottomBtn` 绑定保留**
检查 `document.getElementById('scrollBottomBtn').onclick = scrollBottom;`（约 index.html:654）仍存在、未被改动。

- [ ] **Step 4: 桌面验证合并按钮**
刷新网页，确认底部只剩 `▲上滑`/`▼下滑`/`▽到底页面` 三个按钮；在普通 CLI 与 TUI（vim/less）中点 `▲上滑`/`▼下滑` 都能滚动（按住可连续滚动）。控制台无报错。

- [ ] **Step 5: 提交**
```bash
git add public/index.html
git commit -m "feat: 合并滚动按钮为 2 个（调 smartScroll）"
```

---

### Task 4: 滚动按钮显隐（class + 初始化）

**Files:**
- Modify: `public/styles.css`（新增 `.hidden { display: none !important; }`）
- Modify: `public/index.html`（新增 `applyScrollButtonsVisibility()` + 初始化调用）

**Interfaces:**
- Consumes: `scrollGroupEl`（全局，index.html:102 已定义）、`showScrollButtons`（Task 2 全局变量）
- Produces: `applyScrollButtonsVisibility()`（供 Task 5 接收侧调用）

- [ ] **Step 1: `styles.css` 新增 `.hidden` 规则**（加在文件合适位置，如 `touch-action` 相关规则附近）：
```css
        .hidden { display: none !important; }
```

- [ ] **Step 2: `public/index.html` 新增 `applyScrollButtonsVisibility()`**
在 `setupTouchScroll` 函数定义附近（或显隐相关处）新增：
```js
        function applyScrollButtonsVisibility() {
            scrollGroupEl.classList.toggle('hidden', !showScrollButtons);
        }
```

- [ ] **Step 3: 初始化时调用一次**
在 `setupTouchScroll();`（约 index.html:646）之后插入：
```js
        applyScrollButtonsVisibility();
```

- [ ] **Step 4: 桌面验证显隐（临时手动）**
刷新网页，在控制台执行 `showScrollButtons = false; applyScrollButtonsVisibility();` → 三个按钮消失；`showScrollButtons = true; applyScrollButtonsVisibility();` → 出现。验证后恢复。

- [ ] **Step 5: 提交**
```bash
git add public/index.html public/styles.css
git commit -m "feat: 滚动按钮显隐 class + 初始化应用"
```

---

### Task 5: 设置弹窗（三行 + apply + 接收侧）

**Files:**
- Modify: `public/index.html:181-185`（`buildSettingsModal` 在"按住页面滚动间隔"行之后加 3 行）
- Modify: `public/index.html:230`（同步当前值，在 `settingsScrollIntervalPageInput` 之后）
- Modify: `public/index.html:302`（`applySettingsScrollIntervalPage` 之后加 3 个 apply 函数）
- Modify: `public/index.html:607`（`client_tail_max` 接收处理之后加 3 个接收分支）

**Interfaces:**
- Consumes: `swipeThreshold`/`swipeClassify`/`showScrollButtons`（全局）、`wsSend`、`fbBtn`、`applyScrollButtonsVisibility()`（Task 4）、`scrollGroupEl`
- Produces: 无新导出；设置改完经 `wsSend` → 服务端广播 → 接收侧更新

- [ ] **Step 1: `buildSettingsModal` 加 3 行**（在"按住页面滚动间隔"的 `</div>;` 之后插入）：
```js
            // 滑动滚动阈值 (px)
            html += '<div class="modal-row">';
            html += '滑动滚动阈值 (px) <input type="number" id="settingsSwipeThresholdInput" min="1" max="200" step="1" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-swipeThreshold" onclick="applySettingsSwipeThreshold()">应用</button>';
            html += '</div>';

            // 滑动判定阈值 (px)
            html += '<div class="modal-row">';
            html += '滑动判定阈值 (px) <input type="number" id="settingsSwipeClassifyInput" min="1" max="100" step="1" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-swipeClassify" onclick="applySettingsSwipeClassify()">应用</button>';
            html += '</div>';

            // 显示滚动按钮
            html += '<div class="modal-row">';
            html += '<label><input type="checkbox" id="settingsShowScrollButtonsInput"> 显示滚动按钮</label>';
            html += '<button class="btn-primary" id="btn-apply-showScrollButtons" onclick="applySettingsShowScrollButtons()">应用</button>';
            html += '</div>';
```

- [ ] **Step 2: 同步当前值**（在现有 `document.getElementById('settingsScrollIntervalPageInput').value = scrollIntervalPage;` 之后插入）：
```js
            document.getElementById('settingsSwipeThresholdInput').value = swipeThreshold;
            document.getElementById('settingsSwipeClassifyInput').value = swipeClassify;
            document.getElementById('settingsShowScrollButtonsInput').checked = showScrollButtons;
```

- [ ] **Step 3: 新增 3 个 apply 函数**（在 `applySettingsScrollIntervalPage` 函数结束后插入）：
```js
        function applySettingsSwipeThreshold() {
            const v = parseInt(document.getElementById('settingsSwipeThresholdInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 200) { wsSend({ type: 'swipe_threshold', data: v }); fbBtn('btn-apply-swipeThreshold', true); }
            else fbBtn('btn-apply-swipeThreshold', false);
        }
        function applySettingsSwipeClassify() {
            const v = parseInt(document.getElementById('settingsSwipeClassifyInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 100) { wsSend({ type: 'swipe_classify', data: v }); fbBtn('btn-apply-swipeClassify', true); }
            else fbBtn('btn-apply-swipeClassify', false);
        }
        function applySettingsShowScrollButtons() {
            const v = document.getElementById('settingsShowScrollButtonsInput').checked;
            wsSend({ type: 'show_scroll_buttons', data: v });
            fbBtn('btn-apply-showScrollButtons', true);
        }
```

- [ ] **Step 4: 接收侧加 3 个分支**（在现有 `client_tail_max` 接收处理块的 `}` 之后插入）：
```js
                    } else if (msg.type === 'swipe_threshold') {
                        swipeThreshold = msg.data;
                        addFrontendLog('滑动滚动阈值同步为 ' + swipeThreshold + ' px', 'in');
                    } else if (msg.type === 'swipe_classify') {
                        swipeClassify = msg.data;
                        addFrontendLog('滑动判定阈值同步为 ' + swipeClassify + ' px', 'in');
                    } else if (msg.type === 'show_scroll_buttons') {
                        showScrollButtons = msg.data;
                        applyScrollButtonsVisibility();
                        addFrontendLog('滚动按钮显示状态同步为 ' + (showScrollButtons ? '显示' : '隐藏'), 'in');
```

- [ ] **Step 5: 桌面验证设置链路**
刷新网页（务必先 `npm run restart` 让 Task 1 的服务端生效）。打开设置弹窗：
1. 三个新输入框/勾选框存在，值分别 24 / 10 / 勾选。
2. 改 `滑动滚动阈值` 为 60 → 应用 → 控制台（前端日志/网络）应见 `swipe_threshold=60` 广播；再开一个浏览器标签，该标签设置弹窗里值也变 60（多端同步）。
3. 取消"显示滚动按钮"勾选 → 应用 → 三个按钮立即消失；另一标签也同步消失。
4. 前端日志出现对应同步记录。

- [ ] **Step 6: 提交**
```bash
git add public/index.html
git commit -m "feat: 设置弹窗新增滑动阈值/判定/按钮显隐三项（多端同步）"
```

---

### Task 6: 安卓真机 + 多端验收（用户执行）

**Files:** 无代码改动（仅验收与按反馈微调）

**Interfaces:**
- Consumes: 已部署的前端 + 已重启的后端

- [ ] **Step 1: 真机滑动手感随设置变化**
安卓浏览器连服务，刷新。设置里改 `滑动滚动阈值`(如 24→60) 与 `滑动判定阈值`，应用后真机上下滑手感随之变化（阈值越大越"顿"、越小越"灵敏"）。

- [ ] **Step 2: 多端同步验证**
桌面一个标签改上述设置 / 勾掉"显示滚动按钮"，安卓真机（或另一标签）实时同步，无需手动刷新。

- [ ] **Step 3: 合并按钮真机验证**
真机点 `▲上滑`/`▼下滑`：TUI（vim/less/htop）与普通 CLI 都响应；按住连续滚动正常。

- [ ] **Step 4: 显隐持久验证**
切会话 / 重渲染快捷键后，按钮显隐状态保持；刷新页面后状态从服务端恢复。

- [ ] **Step 5: 手感微调（如需）**
若默认 24/10 不合适，在设置弹窗调即可，无需改代码。

---

## 自审（Self-Review）

**1. Spec 覆盖：**
- swipeThreshold/swipeClassify 入设置（config + loadConfig + 下发 + handler + 弹窗 + apply + 接收 + 日志）→ Task 1 + 5 ✅
- 按钮合并 4→2（DOM + 绑定 + getScrollInterval 自适应）→ Task 3 ✅
- showScrollButtons 显隐（config + handler + class + applyScrollButtonsVisibility + 初始化 + 弹窗 + 接收）→ Task 1 + 4 + 5 ✅
- 单一用户无兼容 → config.json 直接写字段，loadConfig 仅兜底（无迁移逻辑）→ Task 1 ✅
- 多端同步 → broadcast 全链路贯穿 Task 1/5 ✅
- 性能分析 → 仅变量/class 变更，无额外开销（spec 已载明）✅

**2. 占位符扫描：** 无 TBD/TODO；每步含具体代码/命令/预期输出。

**3. 类型/签名一致性：**
- `applyScrollButtonsVisibility()` 在 Task 4 定义、Task 5 接收侧调用 → 一致。
- `getScrollInterval()` 在 Task 3 定义并使用 → 一致。
- `swipeThreshold`/`swipeClassify`/`showScrollButtons` 全局变量在 Task 2 定义，Task 3/4/5 引用 → 一致。
- message type 字符串 `swipe_threshold`/`swipe_classify`/`show_scroll_buttons` 在 server.js（Task 1）与前端 apply/接收（Task 5）完全一致。
- 无跨任务命名漂移。
