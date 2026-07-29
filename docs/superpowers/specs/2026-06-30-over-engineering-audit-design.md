# 过度设计审查：移除 4 个 hidden input + 简化 syncLayoutWidths + 改事件驱动连接状态

## 背景与目标

### 触发

用户主动要求对项目做一次"过度设计"审查，重点关注**前端样式设计**。本 spec 是审查结论的落地，覆盖 **3 个明确的过度设计 / 冗余点**：
1. 4 个 hidden input 当 state 容器
2. `syncLayoutWidths` 函数 4 个触发点中 `window resize` 是冗余
3. `updateWsStatus` 1Hz 轮询可改为事件驱动

审查过程中提出的其他 8 个候选点经用户逐一确认均为**合理的设计选择或可选优化**，均不在本次改动范围（详见"不在本次范围"章节）。

### 审查范围

- 前端 `public/index.html`（HTML / 内联 CSS / 内联 JS）
- 后端 `server.js`
- 配置文件 `config.json`（只读，未发现过度设计）
- 项目约定文档 `AGENTS.md`

### 审查方法

逐节列出候选点 → 用户根据使用场景（含**移动端为主**）判断 → 撤回不合理的"过度设计"指控 → 留下确属过度的点。

### 设计目标

- 删除无意义的代码组织反模式
- 删除冗余的事件监听
- 简化数据流（DOM 不再当 state 容器）
- 用事件替代轮询（前提是事件能覆盖）
- 行为完全不变（纯重构）

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 范围 | 改 2 条：hidden input 移除 + syncLayoutWidths 触发点精简 | 其他候选点经用户确认均合理（详见"不在本次范围"） |
| 改动性质 | 纯重构 | 不改行为、不改协议、不改样式 |
| 状态存储 | 改用 JS 顶层 `let` 变量 | 简单值无需 DOM 容器 |
| `rowsInput / colsInput` | 新增 `let rows, cols` 替代 | onmessage resize 分支直接赋值；createTermInstance 直接读 |
| `scrollStepInput / maxBufferInput` | 删 input，复用已有的 `let scrollStep, maxBuffer` | 原本就同时存在 DOM 和 JS 两份，纯删除 DOM 那份 |
| onmessage 处理器 | 同步更新 JS 变量，不再 `getElementById(...).value = ...` | 减少 5 处 DOM 查询 |
| `applySettingsSize` / `openSettingsModal` | 同步改为读 JS 变量 | 保持函数体最小改动 |
| `syncLayoutWidths` 触发点 | 减为 2 个（删 `window resize`） | 终端容器 `align-self: flex-start` 不随窗口缩放变化，resize 永远无效 |
| 保留 `DOMContentLoaded` 守卫 | 是 | 保证首屏渲染前 toolbar/hotkeys-bar 已是正确宽度 |
| 保留 `ResizeObserver` | 是 | xterm cols 变化的唯一触发点 |
| `updateWsStatus` 轮询 | 改事件驱动 | 用户主动要求测试，弱信号"沉默死亡"改用 onerror + 显式重连覆盖 |
| 自动重连 | 移到 `ws.onclose` 内调 `connect()` | 1Hz 轮询的重连责任由 onclose 接管 |
| onerror 监听 | 新增 | 错误时立即更新 UI（不让 onclose 延迟 UI 显示） |
| `config.json` | 不变 | 行为完全不变 |
| 服务端 | 不变 | 本次纯前端改动 |
| WebSocket 协议 | 不变 | 本次纯前端改动 |
| 样式 | 不变 | 纯重构，无视觉变化 |
| AGENTS.md | 同步新增注意事项 16（审查结论），修改注意事项 13（syncLayoutWidths 触发点） | 反映 3 项改动 |

## 前端改动（public/index.html）

### 1. 删除 4 个 hidden input 节点

**位置**：[L189-192](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L189-L192)

**当前**：

```html
<!-- 4 个 hidden input 占位（保持原 id，让 onmessage 处理器能继续更新其 value） -->
<input type="hidden" id="rowsInput">
<input type="hidden" id="colsInput">
<input type="hidden" id="scrollStepInput">
<input type="hidden" id="maxBufferInput">
```

**改为**：直接删除这 4 行 + 上方注释。

### 2. 顶层新增 4 个 JS 变量

**位置**：[L195-209](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L195-L209) 附近的变量声明区

**当前已有**（无需新增，直接复用）：

```js
let scrollStep = 3;
let maxBuffer = 50000;
```

**新增**：

```js
// rows / cols 原本通过 hidden input 存储；改为 JS 变量更直接
// 初始 null：服务端 resize 消息到达前不调用 term.resize（与旧版 hidden input 空 value 行为一致）
let rows = null;
let cols = null;
```

最终顶层声明（合并后）：

```js
let ws = null;
const terms = {};
const wrappers = {};
let activeId = null;
const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
let hotkeys = {};
let scrollStep = 3;
let maxBuffer = 50000;
let rows = null;   // 新增：替代 #rowsInput
let cols = null;   // 新增：替代 #colsInput
let editorDiv = null;
let editingKey = null;
let names = {};
let pendingCreate = false;
let isFirstList = true;
let settingsDiv = null;
```

### 3. onmessage 处理器中 4 处更新

**位置**：[L402-417](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L402-L417)

**当前**：

```js
} else if (msg.type === 'resize') {
    document.getElementById('rowsInput').value = msg.data.rows;
    document.getElementById('colsInput').value = msg.data.cols;
    Object.keys(terms).forEach(id => {
        terms[id].resize(msg.data.cols, msg.data.rows);
    });
} else if (msg.type === 'hotkeys') {
    hotkeys = msg.data || {};
    renderHotkeys();
    if (editorDiv) openHotkeyEditor();
} else if (msg.type === 'scroll_step') {
    scrollStep = msg.data;
    document.getElementById('scrollStepInput').value = scrollStep;
} else if (msg.type === 'max_buffer') {
    maxBuffer = msg.data;
    document.getElementById('maxBufferInput').value = maxBuffer;
}
```

**改为**：

```js
} else if (msg.type === 'resize') {
    rows = msg.data.rows;
    cols = msg.data.cols;
    Object.keys(terms).forEach(id => {
        terms[id].resize(cols, rows);
    });
} else if (msg.type === 'hotkeys') {
    hotkeys = msg.data || {};
    renderHotkeys();
    if (editorDiv) openHotkeyEditor();
} else if (msg.type === 'scroll_step') {
    scrollStep = msg.data;
} else if (msg.type === 'max_buffer') {
    maxBuffer = msg.data;
}
```

### 4. openSettingsModal 同步初值改为读 JS 变量

**位置**：[L281-284](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L281-L284)

**当前**：

```js
document.getElementById('settingsRowsInput').value = document.getElementById('rowsInput').value;
document.getElementById('settingsColsInput').value = document.getElementById('colsInput').value;
document.getElementById('settingsScrollStepInput').value = scrollStep;
document.getElementById('settingsMaxBufferInput').value = maxBuffer;
```

**改为**：

```js
document.getElementById('settingsRowsInput').value = rows;
document.getElementById('settingsColsInput').value = cols;
document.getElementById('settingsScrollStepInput').value = scrollStep;
document.getElementById('settingsMaxBufferInput').value = maxBuffer;
```

### 5. applySettingsSize 不变

`applySettingsSize` / `applySettingsScrollStep` / `applySettingsMaxBuffer` 三个函数 [L294-316](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L294-L316) 已经是**从弹窗 input 读值**（不是从 hidden input 读值），所以**无需改动**。

### 6. createTermInstance 改为读 JS 变量

**位置**：[L477-478](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L477-L478)

**当前**：

```js
const r = parseInt(document.getElementById('rowsInput').value);
const c = parseInt(document.getElementById('colsInput').value);
if (Number.isInteger(r) && Number.isInteger(c)) {
    term.resize(c, r);
}
```

**改为**：

```js
if (Number.isInteger(rows) && Number.isInteger(cols)) {
    term.resize(cols, rows);
}
```

**保留 `Number.isInteger` 检查的原因**：rows/cols 初始为 `null`，`Number.isInteger(null)` 为 false，跳过 resize。服务端 resize 消息到达后再 resize。**与旧版 hidden input 空 value → `parseInt('') === NaN` → 跳过的行为完全一致**。

### 7. syncLayoutWidths 删除 window resize 监听

**位置**：[L447-448](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L447-L448)

**当前**：

```js
// 窗口尺寸变化时同步
window.addEventListener('resize', syncLayoutWidths);
```

**改为**：删除这一行 + 上一行注释。

**为什么是冗余**：

`#terminal-container` 的 CSS：
```css
#terminal-container {
    width: max-content;          /* 由 xterm 内部 DOM 撑开 */
    align-self: flex-start;      /* flex 列布局中不拉伸 */
}
```

`align-self: flex-start` 决定了 `#terminal-container` 的宽度**不随 `#page` 拉伸**，完全由 xterm 决定。xterm 的宽度由 `cols` 决定。**窗口缩放不会改变 `cols`，因此不会改变 `#terminal-container.offsetWidth`**，`syncLayoutWidths` 读出来还是同一个值，写回去还是同一个值，等于无操作。

**最终保留的 2 个触发点**：

```js
// 触发点 1：DOM 加载完成后首次同步（保证首屏渲染前 toolbar/hotkeys-bar 已是正确宽度）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncLayoutWidths);
} else {
    syncLayoutWidths();
}
// 触发点 2：xterm 尺寸变化时同步（设置弹窗改 rows/cols 后触发）
if (typeof ResizeObserver !== 'undefined') {
    const term = document.getElementById('terminal-container');
    if (term) new ResizeObserver(syncLayoutWidths).observe(term);
}
```

### 8. updateWsStatus 改事件驱动

**位置**：[L338-352](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L338-L352)（connect 内的 onopen/onclose）+ [L675-681](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L675-L681)（updateWsStatus 函数本身）

**当前**（含 1Hz 轮询）：

```js
ws.onopen = () => {
    isFirstList = true;
};
ws.onclose = () => { pendingCreate = false; };

// ... 下方独立的 1Hz 轮询 ...
const wsStatusEl = document.getElementById('wsStatus');
function updateWsStatus() {
    const ok = ws && ws.readyState === 1;
    wsStatusEl.textContent = ok ? '已连接' : '已断连';
    wsStatusEl.style.color = ok ? 'green' : 'red';
    if (!ok) connect();
}
setInterval(updateWsStatus, 1000);
updateWsStatus();
```

**改为**（事件驱动）：

```js
ws.onopen = () => {
    isFirstList = true;
    updateWsStatus();
};
ws.onerror = (e) => {
    console.error('WS error', e);
    updateWsStatus();
};
ws.onclose = () => {
    pendingCreate = false;
    updateWsStatus();
    connect();  // 断连自动重连
};

// ... 下方去轮询的 updateWsStatus ...
const wsStatusEl = document.getElementById('wsStatus');
function updateWsStatus() {
    const ok = ws && ws.readyState === 1;
    wsStatusEl.textContent = ok ? '已连接' : '已断连';
    wsStatusEl.style.color = ok ? 'green' : 'red';
}
```

**关键变化**：

| 项 | 旧 | 新 |
|----|----|----|
| 状态更新触发 | `setInterval` 每秒读 `readyState` | `onopen` / `onerror` / `onclose` 三事件 |
| 自动重连 | `updateWsStatus` 内 `if (!ok) connect()` | `onclose` 内 `connect()` |
| onerror 监听 | 无 | 新增，错误时立即更新 UI |
| 初始 `updateWsStatus()` 调用 | 有（页面加载后调一次） | 删（onopen 会自动触发） |
| `setInterval` | 有 | 删 |

**为什么这样改安全**：

1. 浏览器在 WebSocket 关闭时**几乎总是**会触发 `onclose` —— 这是 spec 行为
2. `onerror` 紧跟在 `onclose` 之前触发，先于 UI 更新
3. 如果 onclose 真的不触发（极端情况：浏览器 bug / OS 网络栈异常），用户可以手动刷新页面 —— 与 1Hz 轮询的"沉默重连"相比，只是少了自动恢复

**已修复的边界情况：重连风暴**（2026-06-30 用户测试发现）

最初实现 `ws.onclose` 内直接调 `connect()` 时存在死循环：onclose 立即触发 connect → 新 WebSocket 立刻失败 → onclose 再次触发 → 1 秒内可能重试几十到几百次。

**修复方案 B**：

```js
let reconnectTimer = null;
function connect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (!navigator.onLine) return;  // 浏览器报告离线时跳过重试
    if (!ws || ws.readyState === 3) {
        ws = new WebSocket(...);
        ws.onclose = () => {
            pendingCreate = false;
            updateWsStatus();
            reconnectTimer = setTimeout(connect, 3000);  // 3 秒后重试
        };
    }
}
window.addEventListener('online', () => { connect(); });  // 网络恢复立即重连
```

**三道防线**：
1. `navigator.onLine` 检查：浏览器报告离线时**不发起新连接**（避免资源浪费）
2. `setTimeout(connect, 3000)`：连接失败后延迟 3 秒再试（避免疯狂重试）
3. `window 'online'` 事件：浏览器报告网络恢复时**立即**重连（不等满 3 秒）

**离线 → 在线全流程**：
```
1. 网络断开
2. 浏览器检测到 → 触发 ws.onerror / onclose
3. onclose 调 setTimeout(connect, 3000)
4. connect() 执行：
   - navigator.onLine === false → return（不发起连接）
5. 网络恢复
6. 浏览器触发 window 'online' 事件
7. connect() 立即执行：
   - navigator.onLine === true → 创建新 WebSocket → 成功
```

**已知风险**（残余）：

- 移动端"沉默死亡"（TCP 连接被 NAT 清掉但浏览器不感知）场景下，纯事件驱动不会自动重连
- 但**现在的设计**：用户切飞行模式 → `navigator.onLine` 立即变 false → 不重试；用户关飞行模式 → `online` 事件触发 → 立即重连
- 真正"网络活着但 WebSocket 死了"的"沉默死亡"场景：UI 显示"已连接"但实际断了 → 用户手动 F5 刷新
- 如果实际使用中发现这是真问题，**可加回轮询**（作为 5-10 秒一次的兜底）或加应用层 ping

## 后端改动（server.js）

**无改动**。本次纯前端重构。

## 行为时序

### 场景 A：连接建立 → resize 消息更新 rows/cols

```
[客户端] connect() 打开 WebSocket
                                          [服务端] on connection
                                            ├─ ws.send(buildListMsg())
                                            └─ ws.send({type:'resize', id:0, data:{rows:60, cols:118}})
                                                                              ↓
                                                          客户端先收到 list
                                                            └─ createTermInstance(id)
                                                                 ├─ rows === null → 跳过 resize
                                                                 └─ xterm 保持默认 80x24
                                                          再收到 resize
                                                            ├─ rows = 60
                                                            ├─ cols = 118
                                                            └─ terms[id].resize(118, 60)
```

**对比旧路径**：旧版 `parseInt(document.getElementById('rowsInput').value)` = `parseInt('')` = `NaN` → 跳过 resize。**完全相同的行为**。

### 场景 B：用户在设置弹窗改终端大小

```
[用户] 改行 60 → 80，列 120 → 100，点「应用」
  ↓
applySettingsSize()
  └─ ws.send({type:'resize', id:0, data:{rows:80, cols:100}})
                                          [服务端] 收到 resize
                                            ├─ config.rows = 80; config.cols = 100
                                            ├─ 所有 pty.resize(100, 80)
                                            └─ broadcast({type:'resize', id:0, data:{rows:80, cols:100}})
                                                                              ↓
                                                          所有客户端 onmessage
                                                            ├─ rows = 80
                                                            ├─ cols = 100
                                                            └─ 所有 xterm.resize(100, 80)
```

行为完全不变。

## 边界情况

| 场景 | 行为 | 是否可接受 |
|------|------|------------|
| `createTermInstance` 在 `resize` 消息到达前被调用 | 旧：`rowsInput.value === ''` → `parseInt('')` → NaN → 跳过 resize；新：`rows === null` → `Number.isInteger(null)` 为 false → 跳过 resize。**行为完全一致** | ✓ |
| 服务端没发 resize 消息 | 旧：跳过 resize（xterm 用内置默认 80x24）；新：跳过 resize（同样 80x24） | ✓ |
| 多客户端同步 | 所有客户端各自 onmessage 各自更新自己的 `rows` / `cols` JS 变量 | ✓ |
| 配置变化时（如服务端改 config.json 重启）| 新连接会收到服务端当前 `rows` / `cols` 的 `resize` 消息 | ✓ |
| 打开设置弹窗但还没收到 resize 消息 | 弹窗内 `settingsRowsInput` / `settingsColsInput` 显示空字符串 | ✓ 与旧版一致 |
| 窗口缩放（不影响 xterm 宽度）| 旧：触发 `syncLayoutWidths`，但 `offsetWidth` 不变，写入同样的值（无操作）；新：`window resize` 监听已删，函数不被调用，**完全等价** | ✓ |
| xterm cols 变化（设置弹窗改 rows/cols）| 旧：ResizeObserver 触发 `syncLayoutWidths`；新：同样 ResizeObserver 触发，**完全等价** | ✓ |
| 首屏渲染前 toolbar 宽度 | 旧：DOMContentLoaded 同步；新：同样 DOMContentLoaded 同步，**完全等价** | ✓ |

## 改动文件清单

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | 删 4 行 hidden input + 4 行注释；删 2 行 `window resize` 监听；删 1 行 `setInterval` + 1 行初始调用；改 ~12 行 JS（onmessage、openSettingsModal、createTermInstance、ws.onopen/onerror/onclose、updateWsStatus） | 纯重构 |
| [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) | 0 | 不动 |
| [config.json](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/config.json) | 0 | 不动 |
| [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) | 改 1 行（注意事项 13：syncLayoutWidths 触发点说明），新增 1 条（注意事项 16） | 文档同步 |

总计代码净 **-9 行**（删 12 行 + 加 3 行 JS 变量声明 + 净 -10 行 JS 逻辑简化 + 删 2 行 window resize + 删 2 行 setInterval/初始调用 + 加 12 行 onopen/onerror/onclose），无新增复杂度。

## 通信协议变化

无变化。本次纯前端重构，WebSocket 协议、config.json 结构、xterm 行为均不变。

## 测试

项目无测试框架（[AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md)），全部手动测试。

### 测试 1：DOM 中无 hidden input

1. 启动 `node server.js`，打开 `http://localhost:<端口>`
2. F12 → Elements
3. 搜索 `rowsInput` / `colsInput` / `scrollStepInput` / `maxBufferInput`
4. **预期**：0 个结果（4 个 input 节点已删）

### 测试 2：JS 变量初始化正确

1. F12 → Console
2. 输入 `rows` / `cols` / `scrollStep` / `maxBuffer`
3. **预期**：
   - `rows` → `null`（连接前初始值）
   - `cols` → `null`（连接前初始值）
   - 收到服务端 resize 消息后 → 来自服务端的 rows/cols 值
   - `scrollStep` → 来自服务端配置
   - `maxBuffer` → 来自服务端配置

### 测试 3：resize 消息同步

1. 打开设置弹窗
2. 改行 60 → 80，列 120 → 100，点「应用」
3. F12 → Console，输入 `rows` / `cols`
4. **预期**：`80` / `100`
5. xterm 终端已 resize（行数变 80，列数变 100）
6. 关闭弹窗，再开 → 弹窗内 rows/cols 输入框显示当前 `80` / `100`

### 测试 4：scrollStep / maxBuffer 消息同步

1. F12 → Console 输入 `scrollStep = 99` 然后 `ws.send(JSON.stringify({type:'scroll_step', data: 99}))`（模拟服务端广播）
2. 检查弹窗里的「滚动行数」输入框
3. **预期**：显示 `99`
4. 同样测试 `maxBuffer`

### 测试 5：xterm resize 行为不变（createTermInstance 路径）

1. F5 刷新页面
2. 观察 xterm 第一个终端的尺寸变化
3. **预期**：
   - xterm 初始化时是默认尺寸（80x24）
   - 服务端 resize 消息到达后 resize 到 config 指定的尺寸
   - 与旧版行为**完全一致**（都是先默认，再 resize 一次）
4. 打开 DevTools Performance 面板录制启动过程
5. **预期**：xterm.resize 调用 1 次（来自 resize 消息），与旧版调用次数相同

### 测试 6：syncLayoutWidths 触发点只剩 2 个

1. 启动 `node server.js`，打开 `http://localhost:<端口>`
2. F12 → Elements → Event Listeners（右下角）
3. 搜索 `window` 节点的 resize 监听器
4. **预期**：0 个 `syncLayoutWidths` 相关监听（已删除）
5. F12 → Console
6. 监控 `syncLayoutWidths` 调用：在 Console 中执行
   ```js
   const orig = syncLayoutWidths;
   let calls = 0;
   syncLayoutWidths = function() { calls++; orig(); };
   ```
7. 缩放浏览器窗口多次
8. **预期**：`calls === 0`（window resize 不再触发）
9. 打开设置弹窗改 rows/cols，点「应用」
10. **预期**：`calls >= 1`（ResizeObserver 触发）
11. F5 刷新页面
12. **预期**：刷新瞬间 `calls >= 1`（DOMContentLoaded 触发首次同步）

### 测试 7：updateWsStatus 改事件驱动后功能正常

1. 启动 `node server.js`，打开 `http://localhost:<端口>`
2. F12 → Console 输入 `setInterval(() => console.log('tick'), 1000)` 启动一个心跳
3. F12 → Elements 搜 `setInterval` 关键字（或在 Source 面板设条件断点）
4. **预期**：源码中**无** `setInterval(updateWsStatus, ...)` 调用
5. 关闭后端服务器（`Ctrl+C` 终止 `node server.js`）
6. **预期**：
   - UI 上的 `#wsStatus` 立即从"已连接"（绿）变"已断连"（红）（`onerror` / `onclose` 触发）
   - Console 出现 `重新连接服务器` 日志（`connect()` 在 `onclose` 内被调）
7. 重启 `node server.js`
8. **预期**：
   - UI 上的 `#wsStatus` 立即从"已断连"（红）变"已连接"（绿）
   - 终端、快捷键等所有功能正常恢复

### 测试 8：移动端弱信号行为（实际使用中观察）

1. 用手机浏览器访问局域网服务
2. 切换网络（WiFi ↔ 4G）、进出电梯等
3. **观察**：
   - 网络断开时 UI 是否及时显示"已断连"
   - 网络恢复时是否自动重连
4. **如果发现 UI 一直显示"已连接"但实际断了**（沉默死亡）：
   - 这是已知的纯事件驱动风险
   - 可加回轮询（`setInterval(updateWsStatus, 5000)` 5 秒一次作为兜底）
   - 或加应用层 ping

### 测试 9：回归

- 多客户端：另一个浏览器 tab 打开同一服务，确认 list / buffer / 弹窗 / 设置同步
- 重连：断网后重连，所有功能正常
- 快捷键编辑弹窗、设置弹窗、可用按键弹窗：均能正常打开/关闭
- 终端交互：输入、滚动、resize 均正常

### 验证清单

- [ ] DOM 中 0 个 hidden input（`#rowsInput` 等 id 不存在）
- [ ] JS 变量 `rows` / `cols` 在连接后被服务端 resize 消息正确赋值
- [ ] 设置弹窗改 rows/cols，xterm 实际尺寸变化
- [ ] 刷新页面后 xterm 是 60×120（默认值立即生效）
- [ ] scrollStep / maxBuffer 弹窗内 input 与 JS 变量同步
- [ ] 多客户端行为一致
- [ ] `window` 节点上无 `syncLayoutWidths` 监听
- [ ] 缩放窗口不再触发 `syncLayoutWidths` 调用
- [ ] 改 rows/cols 仍能触发 `syncLayoutWidths` 调用（ResizeObserver 路径）
- [ ] 源码中无 `setInterval(updateWsStatus, ...)` 调用
- [ ] `ws.onopen` / `onerror` / `onclose` 都调用 `updateWsStatus()`
- [ ] `ws.onclose` 内调 `connect()` 实现自动重连
- [ ] 关闭/重启后端服务器，UI 状态正确切换且能自动恢复连接
- [ ] 移动端弱信号场景下观察一周，确认无沉默死亡（若有问题，回滚为 5 秒一次轮询）
- [ ] AGENTS.md 注意事项 13 文本已更新（同步LayoutWidths 触发点改为 2 个），16 已新增

## 不在本次范围

经用户逐一确认，**以下候选点均为合理的设计选择或可选优化，不在本次改动范围**。记录在 AGENTS.md 注意事项 16 作为"审查结论"备查：

| 候选点 | 结论 | 用户理由 |
|--------|------|----------|
| `min-width: 60px` 按钮最小宽度 | 保留 | 移动端短按钮（"编辑""▲"）的点击区域需要 |
| ~~`syncLayoutWidths` 4 触发点~~ | **已纳入本次范围** | 删 `window resize` 监听（冗余），保留 DOMContentLoaded + ResizeObserver |
| ~~`updateWsStatus` 1Hz 轮询~~ | **已纳入本次范围** | 用户主动测试事件驱动；移动端"沉默死亡"由 onerror + 显式重连覆盖 |
| 70 行 `.modal-box` CSS | 可选优化 | 深色主题与 xterm 一致；改 `<dialog>` 是风格改动，不是简化 |
| 3 个独立"应用"按钮 | 保留 | 一按钮 = 一动作，逻辑清晰 |
| `availableKeys` + `showAvailableKeys` 弹窗 | 保留 | 手机无物理键盘，点选是合理交互 |
| `maxBufferChars` 模块级缓存 | 保留 | 0 性能收益但 0 性能损失；提供代码可读性 |
| `computeSmartName` 智能命名 | 保留 | 配合"重命名全部"维护命名连贯性 |
| `loadConfig` 旧字符数迁移 | 保留 | 一次性技术债清理，复杂度成本极低 |
| `buffer_size` 5s 超时 | 保留 | 移动端极端网络下显示"超时"是有意义的兜底 |
| `rename_all` 无 confirm | 属 UX 问题 | 不是过度设计，是产品决策 |
| 连接时 4 次 `ws.send` 初始广播 | 保留 | 解耦性优先，合 init 反而绕 |
| `pendingCreate` 多客户端标志 | 保留 | 多客户端场景真实存在 |
| `isFirstList` 命名不清晰 | 微调 | 改名或加注释即可，非过度设计 |
| 3 种 event listener 写法 | 保留 | 风格问题，不影响功能 |
| 全局 `mousedown` 拦截 | 保留 | 移动端软键盘 bug 的实际 fix |

**所有"保留"项不代表没有改进空间**，仅代表本次审查的目标（消除过度设计）下不动它们。后续如要做大规模重构（如 `<dialog>` 化、container query 化），可以独立立项。

## 审查方法论记录

本次审查**经过多轮用户反问**才收敛。教训：

1. **不要按"代码洁癖"标准审实际在用的项目** —— 用户的实际使用场景（移动端为主）会产生很多"看起来过度但实际必要"的设计
2. **每条"过度设计"指控都要问"在用户的场景下成立吗"** —— `min-width: 60px`（移动端）、`availableKeys`（手机无键盘）、`updateWsStatus` 1Hz 轮询（弱信号可靠性）都曾被我错判
3. **明确"重构"和"设计改动"的边界** —— 改 `<dialog>` 是风格改动，不属于本次"过度设计"审查；改 hidden input 是纯重构，符合
4. **用户对自己项目的判断**永远**优先于**审阅者的"理论分析"
5. **"看起来对"的代码仍可能有冗余** —— `syncLayoutWidths` 4 个触发点中 `window resize` 单独看无害，但结合 `align-self: flex-start` 后永远无效。删它需要技术判断（CSS 行为）而非场景判断
