# 按住滚动间隔拆分（终端 vs 页面）设计

## 目标

设置弹窗中"按住滚动间隔 (ms)"一项同时控制 4 个按钮的定时器间隔（终端 SGR 滚轮 + 页面 xterm 滚动），现拆成两项独立配置：

- **按住终端滚动间隔 (ms)** — 控制「▲上滑终端 / ▼下滑终端」（SGR 滚轮事件发到 PowerShell）
- **按住页面滚动间隔 (ms)** — 控制「▲上滑页面 / ▼下滑页面」（xterm.scrollLines 滚视图）

协议层 hard break：不兼容旧 `scroll_interval` 消息与旧 `config.scrollInterval` 字段。

## 用户故事

1. 用户首次进入页面（无 config.json）：两项默认值均为 100ms。
2. 用户在设置弹窗中改"按住终端滚动间隔"为 50ms 并点"应用"：仅「上滑/下滑终端」的按住周期变化，「上滑/下滑页面」不受影响。
3. 用户再改"按住页面滚动间隔"为 200ms 并点"应用"：仅「上滑/下滑页面」的按住周期变化。
4. 用户重启页面后：两个新值都从 config.json 恢复。
5. A 客户端改"终端"间隔，B 客户端在另一窗口中能立即按新值响应（A 改"终端"对 B 的"页面"无影响）。
6. F12 手动发旧消息 `{type:'scroll_interval', data: 50}`：服务端无处理分支，被忽略。

## 协议变更

### 删除

- 客户端 → 服务端 `scroll_interval` 消息
- 服务端 → 客户端 `scroll_interval` 消息
- `config.scrollInterval` 字段
- 客户端 `let scrollInterval = 100;` 全局变量
- 客户端 `applySettingsScrollInterval()` 函数
- 设置弹窗中"按住滚动间隔 (ms)"输入项 + 应用按钮
- 客户端 ws.onmessage 中 `else if (msg.type === 'scroll_interval')` 分支
- 服务端 `wss.on('connection')` 中 `ws.send(JSON.stringify({ type: 'scroll_interval', data: config.scrollInterval }));`
- 服务端 `ws.on('message')` 中 `else if (type === 'scroll_interval')` 分支

### 新增

| 方向 | 消息 | 载荷 | 行为 |
|------|------|------|------|
| C → S | `scroll_interval_terminal` | `{data: ms}` | 写 `config.scrollIntervalTerminal`、落盘、广播 |
| S → C | `scroll_interval_terminal` | `{data: ms}` | 全量广播 |
| C → S | `scroll_interval_page` | `{data: ms}` | 写 `config.scrollIntervalPage`、落盘、广播 |
| S → C | `scroll_interval_page` | `{data: ms}` | 全量广播 |

### 服务端校验

- `data` 必须是 `Number.isInteger(v) && v >= 1 && v <= 1000`，非法值整条消息拒收（不写盘、不广播）。
- 客户端 `applySettingsXxx` 用 `fbBtn` 反馈「✓已应用 / ✗无效」。

## 数据模型

### config.json

```json
{
  "sizeSlots": { "large": { "rows": 60, "cols": 120 }, "small": { "rows": 24, "cols": 80 } },
  "currentSize": "large",
  "hotkeys": {},
  "scrollIntervalTerminal": 100,
  "scrollIntervalPage": 100,
  "maxBuffer": 10,
  "maxFrontendLogs": 50,
  "clientTailMax": 4096
}
```

**注意**：`scrollInterval` 字段已彻底删除。**不**做旧值迁移（用户明确要求不向旧版本兼容）。

### 客户端全局

```javascript
// 替换原 let scrollInterval = 100;
let scrollIntervalTerminal = 100;
let scrollIntervalPage = 100;
```

## UI 变更

### 设置弹窗

将原"按住滚动间隔 (ms)"一行替换为两行（结构与现有 `applySettingsSizeFor` 大/小尺寸对称）：

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

同步当前值到弹窗（替换原 `settingsScrollIntervalInput.value = scrollInterval;`）：

```javascript
document.getElementById('settingsScrollIntervalTerminalInput').value = scrollIntervalTerminal;
document.getElementById('settingsScrollIntervalPageInput').value = scrollIntervalPage;
```

### 应用逻辑

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

### setupHoldScroll 改造

扩展为 `setupHoldScroll(btnId, fn, intervalGetter)`，定时器触发时通过 getter 读最新值（保留"设置变更后立即生效"的现有行为）：

```javascript
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

### ws.onmessage 新增分支

```javascript
} else if (msg.type === 'scroll_interval_terminal') {
    scrollIntervalTerminal = msg.data;
    addFrontendLog('终端按住滚动间隔同步为 ' + scrollIntervalTerminal + ' ms');
} else if (msg.type === 'scroll_interval_page') {
    scrollIntervalPage = msg.data;
    addFrontendLog('页面按住滚动间隔同步为 ' + scrollIntervalPage + ' ms');
}
```

**删除**原 `else if (msg.type === 'scroll_interval')` 分支。

## 后端逻辑

### loadConfig 改造

- 默认 `scrollIntervalTerminal: 100, scrollIntervalPage: 100`（仅在 config.json 不存在时生效）
- 已存在 config.json 时，`cfg.scrollIntervalTerminal` / `cfg.scrollIntervalPage` 缺失或非数字 → 兜底为 100

```javascript
// 默认对象（仅在 CONFIG_PATH 不存在时使用）
const def = {
    sizeSlots: { large: { rows: 60, cols: 120 }, small: { rows: 24, cols: 80 } },
    currentSize: 'large',
    hotkeys: {},
    scrollIntervalTerminal: 100,
    scrollIntervalPage: 100,
    maxBuffer: 10,
    maxFrontendLogs: 50,
    clientTailMax: 4096
};

// 兜底分支（已存在 config.json 时）
if (typeof cfg.scrollIntervalTerminal !== 'number' || cfg.scrollIntervalTerminal < 1 || cfg.scrollIntervalTerminal > 1000) cfg.scrollIntervalTerminal = 100;
if (typeof cfg.scrollIntervalPage !== 'number' || cfg.scrollIntervalPage < 1 || cfg.scrollIntervalPage > 1000) cfg.scrollIntervalPage = 100;
```

### wss.on('connection') 改造

```javascript
// 删除：ws.send(JSON.stringify({ type: 'scroll_interval', data: config.scrollInterval }));
// 新增（位置：scroll_interval 之后，原 max_buffer 之前）
ws.send(JSON.stringify({ type: 'scroll_interval_terminal', data: config.scrollIntervalTerminal }));
ws.send(JSON.stringify({ type: 'scroll_interval_page', data: config.scrollIntervalPage }));
```

### ws.on('message') 改造

**删除**原 `else if (type === 'scroll_interval')` 分支（[server.js L211-L215](server.js#L211-L215)）。

**新增**两个分支（位置：原 scroll_interval 位置，hot_keys 之后）：

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

## 性能影响分析

- **DOM 操作量**：弹窗多 1 个 `modal-row`（~80 字符）
- **事件监听器**：无新增（`setupHoldScroll` 调用数不变，仅签名扩展）
- **布局/回流**：无影响
- **内存开销**：2 个 number 替代 1 个 number
- **执行频率**：仅在用户点"应用"时触发，无定时器常驻
- **网络开销**：每次"应用"1 条消息（约 50 字节）
- **落盘频率**：每次"应用"1 次 `fs.writeFileSync`（与现有模式一致，无防抖，项目已接受此原则，见 AGENTS.md 注意事项 9）
- **广播频率**：每次"应用"广播 1 次给所有 WebSocket 客户端（约 50 字节/客户端）

## 测试清单

| # | 场景 | 步骤 | 预期 |
|---|------|------|------|
| 1 | 首启无 config.json | 删除 config.json，npm start | config.scrollIntervalTerminal=100, scrollIntervalPage=100 |
| 2 | 首连下发 | 浏览器打开 | console 看到 `scroll_interval_terminal`=100 + `scroll_interval_page`=100 两条消息 |
| 3 | 改终端间隔 50ms | 设置弹窗改"按住终端滚动间隔"为 50，应用 | 「上滑/下滑终端」按住周期=50ms；「上滑/下滑页面」保持 100ms |
| 4 | 改页面间隔 200ms | 设置弹窗改"按住页面滚动间隔"为 200，应用 | 「上滑/下滑页面」按住周期=200ms；「上滑/下滑终端」保持上次值 |
| 5 | 持久化 | npm restart | 两个新值都保留 |
| 6 | 多客户端广播 | A 改"终端"间隔，B 监听 | B 收到 `scroll_interval_terminal` broadcast，B 的「上滑终端」立即按新值 |
| 7 | 隔离性 | A 改"终端"，B 监听 | B 收到 `scroll_interval_terminal` 但不收到 `scroll_interval_page`（反之亦然） |
| 8 | 非法值 0 | 弹窗输入 0，应用 | fbBtn 显示「✗无效」；服务端无变化（input min=1 前端拦截 + 服务端兜底） |
| 9 | 非法值 1001 | 弹窗输入 1001，应用 | 同上 |
| 10 | 老的 scroll_interval 消息 | F12 发 `{type:'scroll_interval', data: 50}` | 服务端无处理分支（被忽略），前端无变化 |
| 11 | 设置变更中按住按钮 | 正在按住「上滑终端」时改终端间隔 | 旧定时器周期不变；松开后再次按住按新周期（setInterval 创建时已锁定旧值；符合现有"setInterval 创建后周期不变"的语义） |
| 12 | 设置变更后立即按住 | 改完设置后立刻点按钮 | 按新周期（intervalGetter 在 setInterval 调用时读最新值） |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 设置变更时正在按住按钮 | 旧定时器周期不变 | 已接受"setInterval 创建后周期锁定"的现有行为（场景 11） |
| 多个客户端同时改 | 最后写入者胜出 | 已接受"无锁"原则（与现有 hotkeys / sizeSlots 并发模型一致） |
| 用户误删 config.json | 丢失所有自定义值 | 与现有风险一致；用户可手动恢复 |

## 与现有功能的关系

- **AGENTS.md 注意事项 24**：当前描述"`scrollInterval`（默认 100ms，范围 1-1000ms）"应更新为"`scrollIntervalTerminal`（终端 SGR 滚轮按钮，默认 100ms）+ `scrollIntervalPage`（页面 xterm 滚视图按钮，默认 100ms），范围 1-1000ms"。
- **AGENTS.md 注意事项 28（服务端权威）**：本次新增的 `applySettingsScrollIntervalTerminal` / `applySettingsScrollIntervalPage` 必须遵循"只发不发本地状态"模式（已在设计代码块中体现）。
- **setupHoldScroll 调用点**：4 个调用全部更新（从 2 参数变 3 参数）。
- **PM2 重启**：不受影响（重启后从 config 读新值）。
- **buffer_size / size_slots / current_size / hotkeys / 等其他协议**：完全不受影响。

## 不在范围

- 旧 `scrollInterval` 字段迁移（用户明确不兼容老版本）
- 终端/页面以外的第三种滚动场景
- 滚动加速度 / 缓动效果
- 自定义按钮标签（保持现有「▲上滑终端 / ▼下滑终端 / ▲上滑页面 / ▼下滑页面」）

## 回退方案

本次改动走 git 提交流程，必要时 `git revert HEAD` 即可。

回退时需手动删除本地 config.json 中的 `scrollIntervalTerminal` / `scrollIntervalPage` 字段（否则下次启动会保留这两个字段但代码不再使用，无害但冗余）。
