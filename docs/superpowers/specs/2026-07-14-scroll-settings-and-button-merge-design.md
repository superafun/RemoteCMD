# 滑动手感设置 + 滚动按钮合并 + 按钮显隐（多端同步）

- 日期：2026-07-14
- 状态：设计已批准，待写实现计划
- 前置：触摸滑动模拟鼠标滚轮（MVP）已实现并提交（73426f4 + e4ce604）

## 背景与目标

触摸滑动模拟滚轮已验证可用。本次在其实基础上做三件事，均要求"多端统一、随时可调"：

1. **滑动手感参数入设置**：把 `SWIPE_THRESHOLD`(24px) / `SWIPE_CLASSIFY`(10px) 暴露为设置项，走现有"服务端权威 + 广播所有客户端 + 落盘 config.json + 连接时下发"的全链路，和 `scroll_interval_*` 完全一致。用户在设置弹窗改完，所有设备（含真机）实时生效。
2. **合并滚动按钮（4→2）**：把原 `▲上滑终端/▼下滑终端/▲上滑页面/▼下滑页面` 四个按钮合并为 `▲上滑/▼下滑` 两个，都调 `smartScroll`（逻辑=真实鼠标滚轮），保留 `▽到底页面`。
3. **滚动按钮显隐设置**：新增 `showScrollButtons`(bool) 设置项，控制 `#scrollGroup`（含到底页面）的显示/隐藏，同样多端同步。

## 设计决策（已与用户确认）

- **按钮方向语义**：`▲上滑` = 看更早（终端惯例，与现有按钮一致）；触摸"手指上滑=看更新"是移动端惯例，两者各按各自输入模态的习惯，不冲突。
- **按住滚动间隔**：保留现有"终端间隔 / 页面间隔"两项设置，按**当前模式自适应**取用（`getScrollInterval()`：TUI 时 smartScroll 发 SGR 用终端间隔，普通 CLI 时 smartScroll 滚视口用页面间隔）。不合并成一项。
- **显隐范围**：隐藏整个 `#scrollGroup`（含"到底页面"），即"那几个滑动按钮"全藏。
- **用户规模**：仅当前单一用户，无老用户兼容/迁移需求。`config.json` 直接写入新字段；`loadConfig` 仅保留与其他字段一致的默认值兜底（不作迁移逻辑）。

## 核心机制（复用既有设置链路）

以 `scroll_interval_terminal` 为模板，新增三类设置。链路环节完全一致：

| 环节 | 位置 | 动作 |
|------|------|------|
| config 字段 | `config.json` + `loadConfig` 默认 | 新字段直接写入 config.json；loadConfig 仅作默认值兜底 |
| 连接下发 | `server.js` `wss.on('connection')` | `ws.send({type:'xxx', data: config.xxx})` |
| C→S 处理 | `server.js` message switch | 解析→校验→`config.xxx=...`→`broadcast`→`saveConfig` |
| 全局变量 | `public/index.html` 顶部 `let` | 接收侧赋值、逻辑读取 |
| 设置弹窗 | `buildSettingsModal` 加一行 | 数字输入 / 勾选框 + 应用按钮 |
| apply 函数 | `public/index.html` | `wsSend`（服务端权威，不发本地状态，见 AGENTS.md 注意事项 28） |
| 接收侧 | `ws.onmessage` switch | `xxx = msg.data` + 前端日志（AGENTS.md 注意事项 27） |

## 实现要点

### 1. 配置项定义与默认值

`config.json` 新增三个字段（实现时直接写入文件）：
- `swipeThreshold`: 24（范围 1–200，单位 px）
- `swipeClassify`: 10（范围 1–100，单位 px）
- `showScrollButtons`: true（bool）

`server.js` `loadConfig` 默认值兜底（加在现有 `scrollIntervalPage` 兜底之后，与其他字段写法一致）：
```js
if (typeof cfg.swipeThreshold !== 'number' || cfg.swipeThreshold < 1 || cfg.swipeThreshold > 200) cfg.swipeThreshold = 24;
if (typeof cfg.swipeClassify !== 'number' || cfg.swipeClassify < 1 || cfg.swipeClassify > 100) cfg.swipeClassify = 10;
if (typeof cfg.showScrollButtons !== 'boolean') cfg.showScrollButtons = true;
```
（`config.json` 已含这些字段，兜底仅作安全网，不改写文件。）

### 2. 服务端 message handler（照抄 scroll_interval_terminal）

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

### 3. 连接下发

在 `wss.on('connection')` 现有设置发送处（在 `scroll_interval_page` 发送之后）追加三条：
```js
ws.send(JSON.stringify({ type: 'swipe_threshold', data: config.swipeThreshold }));
ws.send(JSON.stringify({ type: 'swipe_classify', data: config.swipeClassify }));
ws.send(JSON.stringify({ type: 'show_scroll_buttons', data: config.showScrollButtons }));
```
（不进影响 list 处理的设置集合，顺序随意。）

### 4. 前端全局变量

`public/index.html` 顶部（`scrollIntervalTerminal/Page` 附近）新增/替换：
```js
let swipeThreshold = 24;   // 原 const SWIPE_THRESHOLD，改为可变，设置改完实时生效
let swipeClassify  = 10;   // 原 const SWIPE_CLASSIFY
let showScrollButtons = true;
```
并**删除** §触摸滑动 块里的 `const SWIPE_THRESHOLD = 24;` / `const SWIPE_CLASSIFY = 10;` 两行（改由上方全局变量提供）。`onTouchScrollStart/Move` 内 `SWIPE_THRESHOLD`/`SWIPE_CLASSIFY` 全部替换为小写变量名。

### 5. 按钮合并（DOM + 绑定）

`public/index.html` 中 `#scrollGroup` 内四个按钮改为两个：
```html
<div id="scrollGroup" style="display:flex;flex-shrink:0;margin-left:auto;">
    <button id="scrollUpBtn">▲上滑</button>
    <button id="scrollDownBtn">▼下滑</button>
    <button id="scrollBottomBtn">▽到底页面</button>
</div>
```
`setupHoldScroll` 绑定（原 701-704 行四行）改为：
```js
function getScrollInterval() {
    const s = sessions.get(activeId);
    if (s && s.term.modes.mouseTrackingMode !== 'none') return scrollIntervalTerminal;  // TUI：smartScroll 发 SGR
    return scrollIntervalPage;  // 普通 CLI：smartScroll 滚视口
}
setupHoldScroll('scrollUpBtn',   () => smartScroll(-1), getScrollInterval);
setupHoldScroll('scrollDownBtn', () => smartScroll(1),  getScrollInterval);
```
（`scrollBottomBtn` 的 `onclick = scrollBottom` 绑定保持，见 index.html:654。）

### 6. 显隐逻辑

`public/styles.css` 加：
```css
.hidden { display: none !important; }
```
前端新增：
```js
function applyScrollButtonsVisibility() {
    scrollGroupEl.classList.toggle('hidden', !showScrollButtons);
}
```
在初始化（连接建立/首次渲染）后调用一次 `applyScrollButtonsVisibility()`，使刷新后的显隐状态生效；接收侧 `show_scroll_buttons` 处理里也调用它。

### 7. 设置弹窗（buildSettingsModal）

在"按住页面滚动间隔"行之后加三行：
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
同步当前值（在现有 `document.getElementById('settingsScrollIntervalPageInput').value = ...` 之后）：
```js
document.getElementById('settingsSwipeThresholdInput').value = swipeThreshold;
document.getElementById('settingsSwipeClassifyInput').value = swipeClassify;
document.getElementById('settingsShowScrollButtonsInput').checked = showScrollButtons;
```

### 8. apply 函数（服务端权威，不发本地状态）

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

### 9. 接收侧（ws.onmessage switch）

在现有 `client_tail_max` 接收处理之后加：
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
}
```

## 边界与冲突处理

| 场景 | 行为 |
|------|------|
| 设置改滑动阈值 | 变量实时更新，下次滑动即用新值（无需刷新） |
| 显隐切换 | `classList.toggle('hidden')` 作用在 `scrollGroupEl` 上；`renderHotkeys` 重挂元素时 class 保留，显隐不丢 |
| 多端同步 | 任一端改设置 → 服务端广播 → 所有客户端实时更新（含真机） |
| 无活动会话 / 输入条展开 | smartScroll 与 setupHoldScroll 已有守卫，不受影响 |
| 选区模式 | 触摸滑动仍整体禁用（既有逻辑），与本次无关 |

## 性能影响分析

- 设置改完仅更新几个 `let` 变量 + toggle 一个 class；零 DOM 增删、零布局重排（除显隐切换本身的 display 变化）。
- 服务端新增 3 个 message handler，均为 O(1) 校验+广播，与现有设置 handler 同量级。
- 滑动路径零额外开销（仅读取 `swipeThreshold/swipeClassify` 变量替代常量）。
- 结论：无可见性能影响。

## 测试验收

1. **桌面**：设置弹窗改 `滑动滚动阈值`/`滑动判定阈值` → 安卓（或另一标签）刷新后滑动手感随之变化；勾掉"显示滚动按钮" → 三个按钮消失，再勾回出现。
2. **多端同步**：一个浏览器标签改设置，另一标签（或真机）实时同步，无需手动刷新。
3. **合并按钮**：`▲上滑/▼下滑` 在 TUI（vim/less/htop）和普通 CLI 都响应（按住连续滚动）。
4. **显隐持久**：切会话 / 重渲染快捷键后，按钮显隐状态保持。
5. **后端生效**：改了 `server.js`，需用 PM2 重启服务（`npm run restart` 或设置弹窗"重启服务器"），前端刷新加载新前端。

## 不在本次范围

- 把"终端间隔/页面间隔"合并为一项（保留两项、自适应）。
- 滑动手感除阈值/判定外的其他参数（如加速度、惯性）。
- 任何与滚动无关的设置改动。
