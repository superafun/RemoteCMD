# 前端布局改造 + 设置弹窗 + maxBuffer 改 MB 单位 + buffer 检测

## 背景与目标

### 现状问题

1. **页面宽度不跟 xterm 走**：当前 `body` 用了 `width: max-content; min-width: 100%`，宽度由最宽的子元素（顶栏或快捷键栏）撑开。当 xterm 较窄但底部按钮较多时，页面宽度被按钮撑大，与 xterm 实际宽度不一致。
2. **顶栏按钮过多过乱**：现有顶栏同时塞了会话下拉、命名、终端大小（rows/cols）、新建/关闭、滚动行数、maxBuffer 等 10+ 个控件，加上各自的 input 和「确定」按钮，宽度窄时挤在一起难以使用。
3. **maxBuffer 单位不直观**：现在以「字符数」为单位（默认 10000 字符 ≈ 10 KB），用户难以感知实际内存占用和网络传输量。改成 MB 后与磁盘/内存常识一致。
4. **buffer 占用不可见**：用户无法看到当前会话已累积多少 buffer、最大允许多少，只能猜或看 config.json。

### 设计目标

- 页面宽度完全由 xterm 容器撑开，顶栏和快捷键栏的宽度跟随 xterm，按钮在窄宽度下自动换行
- 把终端大小、滚动行数、maxBuffer 三类配置收纳进统一的设置弹窗
- maxBuffer 单位改为 MB，1 MB = 1,000,000 字符（十进制 MB，直观）
- 设置弹窗内新增「buffer 检测」按钮，点一下显示当前会话 buffer 已用 / 上限 / 百分比
- 服务端 buffer 存储引入滞回式截断（阈值 2x，目标 1x），避免大 buffer 下每帧做完整 slice 的性能浪费
- maxBuffer 字符数缓存为模块级变量，仅在配置变更时重算，避免 onData 热路径做无谓乘法

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 页面宽度决定者 | xterm 容器 | 用户明确要求；body 改为跟随容器宽度 |
| 顶栏布局 | flex-wrap：超宽自动折行 | 简单、不依赖 JS 测量 |
| 设置入口 | 顶栏一个「设置」按钮，弹窗收纳 3 类配置 + 检测 | 用户明确要求 |
| 应用方式 | 每项独立「应用」按钮 | 跟原版一致，明确控制 |
| maxBuffer 单位 | 全链路 MB（含服务端） | 用户明确要求 |
| MB 进制 | 1 MB = 1,000,000 字符（十进制） | 直观、与存储容量常识一致 |
| 截断方式 | 字符级 slice（保留原方式） | 用户担心 UTF-8 边界问题；字符级不会切碎多字节字符 |
| 性能优化 | 滞回式：超 2x 才截断，截到 1x | 比每帧 slice 性能高 50x+；代码极简（一个 if） |
| maxBufferChars 缓存时机 | 模块级变量，仅 `loadConfig` 和 `max_buffer` 消息时计算 | 用户明确指出；onData 热路径不重算 |
| 截断存储结构 | 仍用字符串 buffer，不引入 chunk 数组 | 极简主义；V8 rope 字符串摊销 O(1) |
| buffer 检测数据源 | 服务端按请求计算返回 | 服务端是真相；客户端无法获取其他会话 buffer |
| buffer 检测协议 | 新增 `buffer_size` 双向消息 | 语义独立、避免污染 `buffer` 协议 |
| 弹窗样式 | 完全复用现有 `.modal-overlay / .modal-box` | 风格一致；不增 CSS |
| maxBuffer 范围 | 1 ~ 90 MB，默认 10 MB | 1 MB 起步（再小无意义），90 MB 上限防内存爆炸 |
| 配置 storage | config.json `maxBuffer` 改为 MB 整数 | 单一真相；UI 和服务端都基于此 |
| 检测响应展示 | 弹窗内 `当前会话占用: X.XX MB / Y.YY MB (Z.Z%)` | 含三种数据（实际量/上限/百分比） |

## 前端改动（public/index.html）

### 1. 布局：body 宽度由 xterm 决定

移除 `body { width: max-content; min-width: 100% }`，改为 `width: max-content`，让 body 自然跟随 `#terminal-container` 宽度。`#terminal-container` 仍保留 `width: max-content` 由 xterm 内部 DOM 撑开。

```css
html {
    overflow-x: auto;  /* 兜底：xterm 本身比视口宽时滚动 */
}
body {
    margin: 0;
    padding: 0;
    width: max-content;  /* 关键：宽度跟随最宽子元素（#terminal-container） */
    min-width: 100%;     /* 至少铺满视口，避免极窄时挤压 */
}
#terminal-container {
    width: max-content;  /* 由 xterm 撑开 */
}
.toolbar, #hotkeys-bar {
    width: fit-content;  /* 跟随 body（即 xterm 宽度） */
    max-width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}
```

**关键行为**：
- 顶栏/快捷键栏 `flex-wrap: wrap` 在 xterm 窄时按钮自动折行
- xterm 宽度不变（由 `cols × char_width` 决定，固定）
- `html { overflow-x: auto }` 作为兜底：万一 xterm 本身比视口宽，body 加 `min-width: 100%` 保证有滚动条

### 2. 顶栏精简

**移除**（移到弹窗内）：`rowsInput / colsInput` 及其「确定」、「滚动行数」input 及其「确定」、「maxBuffer」input 及其「缓存」按钮。

**保留**：
- `<select id="sessionSelect">` 会话下拉
- `重命名`、`重命名全部` 按钮
- `新建终端`、`关闭终端` 按钮
- `wsStatus` 状态灯（`position: absolute; right: 8px` 不变）
- 新增「设置」按钮

精简后顶栏 DOM：

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

### 3. 设置弹窗 openSettingsModal()

复用现有 `.modal-overlay / .modal-box` 样式。结构：

```
┌─ 设置 ──────────────────────────────┐
│ 终端大小                            │
│ 行 [____] 列 [____]  [应用]          │
│                                      │
│ 滚动行数                            │
│ [____]  [应用]                      │
│                                      │
│ 缓冲区上限 (MB)                     │
│ [____]  [应用]                      │
│                                      │
│ 缓冲区检测                          │
│ [检测当前会话]                       │
│ 当前会话占用: 5.20 MB / 10 MB (52%)│
│                                      │
│                       [关闭]        │
└──────────────────────────────────────┘
```

**实现要点**：
- 弹窗内的 4 个 input（`rowsInput / colsInput / scrollStepInput / maxBufferInput`）与顶栏原本的 4 个 input 用相同 id；弹窗打开时把现有 4 个 input 从顶栏 DOM 移到弹窗内（`appendChild` 移动节点，事件绑定不变；或用 `cloneNode` 复制 input 节点）
- **更简单**：弹窗内直接新建 4 个 input，给不同 id（如 `settingsRowsInput`），新增 `applySettingsSize() / applySettingsScrollStep() / applySettingsMaxBuffer()` 三个函数，分别取对应 id 的值并发送 WebSocket 消息
- 「检测」按钮 → 调 `queryBufferSize()` → 发送 `{type:'buffer_size', id: activeId}` → 收到响应后渲染到 `bufferSizeResult` 元素
- 「关闭」按钮调 `closeSettingsModal()`
- `editorDiv` 已有的全局状态改用通用 `modalDiv`，或新增 `settingsDiv` 复用相同模式

**openSettingsModal() 函数骨架**（与 `openHotkeyEditor()` 对称）：

```javascript
let settingsDiv = null;

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
    html += '<div id="bufferSizeResult" class="empty-hint" style="text-align:left;font-style:normal;color:#c0c0c0;"></div>';

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
}

function closeSettingsModal() {
    if (settingsDiv) { settingsDiv.remove(); settingsDiv = null; }
}

function applySettingsSize() {
    const r = parseInt(document.getElementById('settingsRowsInput').value);
    const c = parseInt(document.getElementById('settingsColsInput').value);
    if (Number.isInteger(r) && Number.isInteger(c)) {
        ws.send(JSON.stringify({ type: 'resize', id: 0, data: { rows: r, cols: c } }));
        // resize 广播会更新 rowsInput / colsInput
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
    // 5s 超时：响应未到则强制恢复按钮，避免永久 disabled
    setTimeout(() => {
        if (btn.disabled) {
            btn.textContent = '检测当前会话';
            btn.disabled = false;
        }
    }, 5000);
}
```

**openSettingsModal 同步禁用态**（新增）：

```javascript
// 弹窗打开时根据 activeId 同步「检测」按钮的禁用态
const queryBtn = document.getElementById('queryBufferSizeBtn');
if (queryBtn) queryBtn.disabled = !activeId;
```

**switchSession 同步禁用态**（新增）：

```javascript
function switchSession(id) {
    // ... 既有逻辑 ...
    // 弹窗打开时同步「检测」按钮的可用性
    const queryBtn = document.getElementById('queryBufferSizeBtn');
    if (queryBtn) queryBtn.disabled = !activeId;
}
```

**设置弹窗 CSS 复用**：
- `.modal-overlay`、`.modal-box`、`.modal-row`、`.modal-actions`、`.empty-hint` 全部沿用现有样式
- 不新增任何 class

### 4. onmessage 新增 buffer_size 分支

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

### 5. wsStatus 指示器保持位置

`#wsStatus` 仍 `position: absolute; right: 8px`，不参与 flex 布局。状态灯在窄宽度下被覆盖？答案：不会，flex-wrap 折行的元素和 absolute 元素不冲突；绝对定位元素脱离文档流，按钮正常折行。

### 6. 顶栏旧 input 清理

`rowsInput / colsInput / scrollStepInput / maxBufferInput` 这 4 个 id 的 input 仍需保留 DOM 节点（作为「当前值」的真实来源，被 onmessage 的 `resize / scroll_step / max_buffer` 分支更新）。但它们不再放在顶栏 `.toolbar` 内，而是放在页面更下方（如 `#terminal-container` 之前、`display: none`），仅作数据存储用。

**简化方案**：
- 顶栏 DOM 彻底移除这 4 个 input 和它们对应的 3 个「确定/缓存」按钮
- 新建 4 个 hidden input：`document.createElement('input')` + `style.display = 'none'`，赋 id 挂到 `document.body` 上
- onmessage 中更新这 4 个 hidden input 的 value（保持原代码结构）
- 弹窗打开时从 hidden input 读初值

```javascript
// 启动时（与现有 maxBufferInput 等价）
const rowsInput = document.createElement('input');
rowsInput.type = 'number'; rowsInput.id = 'rowsInput'; rowsInput.style.display = 'none';
document.body.appendChild(rowsInput);

const colsInput = document.createElement('input');
colsInput.type = 'number'; colsInput.id = 'colsInput'; colsInput.style.display = 'none';
document.body.appendChild(colsInput);

const scrollStepInput = document.createElement('input');
scrollStepInput.type = 'number'; scrollStepInput.id = 'scrollStepInput'; scrollStepInput.style.display = 'none';
document.body.appendChild(scrollStepInput);

const maxBufferInput = document.createElement('input');
maxBufferInput.type = 'number'; maxBufferInput.id = 'maxBufferInput'; maxBufferInput.style.display = 'none';
document.body.appendChild(maxBufferInput);
```

这样：
- 4 个 input 的 id 保持不变 → `resize / scroll_step / max_buffer` onmessage 分支中的 `document.getElementById('xxxInput').value = ...` 不需改
- 顶栏 DOM 干净，只剩按钮
- 弹窗内的 settingsXxxInput 是新 id，专门给弹窗用

### 7. 现有 apply* 函数移除

`applySize() / applyScrollStep() / applyMaxBuffer()` 三个函数在顶栏 button 的 `onclick` 中调用，现在顶栏没有对应 button 了。三个函数可以直接删除（弹窗用新函数 `applySettingsSize / applySettingsScrollStep / applySettingsMaxBuffer`）。

## 后端改动（server.js）

### 1. 模块顶部加 maxBufferChars 缓存

```javascript
let config = loadConfig();
// 缓存 maxBuffer 对应的字符数（1 MB = 1,000,000 字符）；仅在配置变更时重算
let maxBufferChars = (config.maxBuffer || 10) * 1000000;
```

### 2. createSession 的 onData 改用滞回式截断

```javascript
ptyProcess.onData((d) => {
    if (d.includes('\x1b[2J')) sessions[newId].buffer = '';  // 清屏同步
    sessions[newId].buffer += d;
    // 滞回式：超 2x 才截断，截到 1x（避免每帧做 O(N) slice）
    if (sessions[newId].buffer.length > maxBufferChars * 2) {
        sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
    }
    broadcast({ type: 'data', id: newId, data: d });
});
```

**对比原代码**：

```javascript
// 旧：每帧都做 O(N) slice
sessions[newId].buffer = (sessions[newId].buffer + d).slice(-(config.maxBuffer || 10000));
```

**性能分析**：
- 旧：100 帧/秒 × 1000 万字符 slice = 10 亿 ops/sec
- 新：仅在 buffer 涨到 2x 时触发一次 slice，频率低 50x 以上
- V8 内部 rope 字符串优化让 `buffer += d` 摊销 O(1)，不会真复制

### 3. buffer 请求路径用缓存的 maxBufferChars

```javascript
else if (type === 'buffer' && sessions[id]) {
    const buf = sessions[id].buffer;
    // 上限保护：保证下行不超过 maxBuffer
    const data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
    ws.send(JSON.stringify({ type: 'buffer', id, data }));
}
```

### 4. max_buffer 消息更新缓存

```javascript
else if (type === 'max_buffer') {
    config.maxBuffer = data;
    maxBufferChars = data * 1000000;  // 关键：更新缓存
    broadcast({ type: 'max_buffer', data: config.maxBuffer });
    saveConfig(config);
}
```

### 5. connection 处理器推送 max_buffer（不变）

```javascript
ws.send(JSON.stringify({ type: 'max_buffer', data: config.maxBuffer }));
```

### 6. 新增 buffer_size 请求处理

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

**id 不存在时的容错**：保留 `&& sessions[id]` 守卫；id 无效时不响应（避免泄漏会话存在性信息）。

### 7. 注释更新

- 删除「缓冲区上限为 maxBuffer 字符（默认 10000）」的旧描述
- 新增「缓冲区上限以 MB 存储，1 MB = 1,000,000 字符，滞回式截断」说明

## 行为时序

### 场景 A：设置弹窗打开 → 应用配置

```
[用户] 点顶栏「设置」
  ↓
openSettingsModal()
  ├─ 生成 modal DOM，附到 body
  ├─ 从 4 个 hidden input 读初值填到 settingsXxxInput
  └─ settingsDiv 设置为非 null
  ↓
[用户] 改「缓冲区上限」10 → 15，点「应用」
  ↓
applySettingsMaxBuffer()
  ├─ 校验 1 <= v <= 90
  ├─ maxBuffer = 15 (前端状态)
  └─ ws.send({type:'max_buffer', data: 15})
                                          [服务端] 收到 max_buffer
                                            ├─ config.maxBuffer = 15
                                            ├─ maxBufferChars = 15000000  ← 缓存更新
                                            ├─ saveConfig(config)
                                            └─ broadcast({type:'max_buffer', data: 15})
                                                                              ↓
                                                          所有客户端 onmessage
                                                            └─ maxBufferInput.value = 15
  ↓
[用户] 关闭弹窗
  ↓
closeSettingsModal()
  └─ settingsDiv.remove(); settingsDiv = null
```

### 场景 B：buffer 检测

```
[用户] 打开设置弹窗，点「检测当前会话」
  ↓
queryBufferSize()
  ├─ btn.textContent = '检测中...'
  ├─ btn.disabled = true
  └─ ws.send({type:'buffer_size', id: activeId})
                                          [服务端] 收到 buffer_size
                                            ├─ sessions[id] 存在 → 计算
                                            └─ ws.send({type:'buffer_size', id, used: N, max: M})
                                                                              ↓
                                                          客户端 onmessage
                                                            ├─ usedMB = (N / 1000000).toFixed(2)
                                                            ├─ maxMB = (M / 1000000).toFixed(2)
                                                            ├─ pct = ((N / M) * 100).toFixed(1)
                                                            ├─ bufferSizeResult.textContent = `...`
                                                            ├─ btn.textContent = '检测当前会话'
                                                            └─ btn.disabled = false
```

### 场景 C：maxBuffer 截断（高输出场景）

```
[PTY] 持续输出 "x" * 1000 chars/帧，100 帧/秒
  ↓
[服务端] ptyProcess.onData
  ├─ d.length = 1000
  ├─ buffer += d  ← rope 字符串，O(1) 摊销
  ├─ if (length > maxBufferChars * 2)
  │    └─ 触发 slice，buffer 回到 maxBufferChars
  │    （10 MB 设置时，约每 10 秒触发一次）
  └─ broadcast({type:'data', id, data: d})
  ↓
[客户端] 收到 data，正常写入 xterm
```

## 边界情况

| 场景 | 行为 | 是否可接受 |
|------|------|------------|
| maxBuffer 旧 config.json（值是 10000） | 启动时 `config.maxBuffer = 10000`，`maxBufferChars = 10,000,000,000`（100 亿字符）| ⚠️ 内存爆炸 |
| 旧 config 迁移 | **实现时**手动把 config.json 的 `maxBuffer` 从 10000 改成 10 | ✓ 单次操作 |
| 配置文件无 maxBuffer 字段 | `loadConfig` 默认值改为 `{ rows: 30, cols: 80, hotkeys: {}, scrollStep: 3, maxBuffer: 10 }` | ✓ |
| buffer 截断时 UTF-8 边界 | 字符级 slice 不切碎多字节字符 | ✓ 用户担心的问题已规避 |
| 多个会话同时高输出 | 每个会话独立 `sessions[id].buffer`，独立触发截断 | ✓ |
| 检测时 activeId 已被 kill | 服务端 `&& sessions[id]` 守卫，id 无效时不响应；客户端 `queryBufferSize` 检查 `activeId` 非空 | ✓ |
| 检测时断网 | 5s 后超时自动恢复按钮 | ✓ |
| 检测按钮超时 | setTimeout 5s 强制恢复 | ✓ |
| 弹窗打开时无 activeId | 「检测」按钮初始 disabled | ✓ |
| 弹窗打开后切换会话 | switchSession 同步按钮 disabled | ✓ |
| maxBuffer = 1（最小） | 字符数 = 1,000,000，slice 频繁但仍可工作 | ✓ |
| maxBuffer = 90（最大） | 字符数 = 90,000,000，slice 偶尔触发；内存中 buffer 上限 180 MB | ✓ |
| 弹窗打开时收到 max_buffer 广播 | 弹窗内 settingsMaxBufferInput 不自动更新 | ⚠️ UX 细节 |
| 弹窗内 input 与服务端状态同步 | 弹窗打开后点应用才同步；服务端广播的 max_buffer 不会反向更新弹窗 input | ✓ 简化设计 |
| 弹窗被网络断开后状态错乱 | closeSettingsModal 正常移除 DOM | ✓ |
| 多个弹窗同时打开（设置 + 快捷键编辑） | 各有独立 modalDiv，DOM 互不干扰 | ✓ |
| 输入 rowsInput 值非法 | applySettingsSize 校验后不发消息 | ✓ |
| 输入 maxBuffer 值非法（> 90 或 < 1） | applySettingsMaxBuffer 校验后不发消息 | ✓ |

## 改动文件清单

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) | 改 ~15 行 | maxBufferChars 缓存；onData 滞回式截断；buffer 请求上限保护；max_buffer 消息更新缓存；新增 buffer_size 处理 |
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | 改 ~50 行 + 增 ~60 行 | 布局 CSS；顶栏精简；hidden input 模式；openSettingsModal + 5 个新函数；onmessage 新增 buffer_size 分支 |
| [config.json](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/config.json) | 改 1 字段 | `maxBuffer` 从 10000 → 10（MB） |
| [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) | 改 ~10 行 | 更新注意事项（buffer 语义改 MB，新增 buffer_size 协议，更新 maxBuffer 描述） |

总计前端净 +60 行，后端改 ~15 行，1 个协议字段，1 个配置文件，1 个文档。

## 通信协议变化

| 方向 | type | 变化 |
|------|------|------|
| 服务端 → 客户端 | `buffer_size` | **新增**：`{type, id, used, max}` |
| 客户端 → 服务端 | `buffer_size` | **新增**：`{type, id}` |
| 服务端 → 客户端 | `max_buffer` | 值语义从「字符数」改为「MB 数」 |
| 客户端 → 服务端 | `max_buffer` | 值语义从「字符数」改为「MB 数」 |
| 其他 | 不变 | - |

## 测试

项目无测试框架（[AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md)），全部手动测试。

### 测试 1：布局 - 页面宽度由 xterm 决定

1. 启动 `node server.js`，打开 `http://localhost:<端口>`
2. 把浏览器窗口缩窄到 ~400px
3. **预期**：
   - body 宽度 = xterm 宽度
   - 顶栏按钮在窄宽度下自动换行
   - 快捷键栏按钮自动换行
   - xterm 本身不变形
4. 拉宽到 ~1600px，确认按钮回到一行
5. F12 → Console，输入 `document.body.offsetWidth === document.getElementById('terminal-container').offsetWidth`，应返回 `true`

### 测试 2：顶栏精简

1. 打开页面，**预期**：
   - 顶栏只有：会话下拉、重命名、重命名全部、新建终端、关闭终端、设置、状态灯
   - 没有任何 `<input>` 标签
2. F12 → Elements，搜索 `rowsInput`，应找到 `<input style="display: none">`（不在顶栏 DOM 中）
3. 顶栏宽度应随 xterm 宽度变化（不是固定值）

### 测试 3：设置弹窗

1. 点顶栏「设置」→ 弹窗出现
2. **预期**：
   - 弹窗含 4 块：终端大小、滚动行数、缓冲区上限、缓冲区检测
   - 弹窗样式与现有热键编辑弹窗一致（`.modal-box` 背景、字号、按钮风格）
3. 改「行」30 → 60 → 点「应用」→ 终端高度变化
4. 改「滚动行数」3 → 10 → 点「应用」→ 滚动按钮按 10 行/次工作（`▲上滑终端` 连点 5 次共上滑 50 行）
5. 改「缓冲区上限」10 → 20 → 点「应用」
6. **预期**：服务端 `console.log(config.maxBuffer)` 输出 20；`cat config.json` 中 `maxBuffer` 字段为 20
7. 点「关闭」→ 弹窗消失

### 测试 4：buffer 检测

1. 打开设置弹窗
2. 在终端跑 `while ($true) { Get-Date; Start-Sleep 1 }` 持续输出
3. 弹窗里点「检测当前会话」
4. **预期**：
   - 几秒内显示 `当前会话占用: X.XX MB / 20.00 MB (Y.Y%)`
   - 数字随终端输出量增长而增加（多次点击数字会涨）
5. 关闭会话（点「关闭终端」）→ 弹窗里「检测」按钮应变灰
6. 在弹窗打开状态下切换到其他会话（用下拉框）→ 「检测」按钮应恢复可用
7. 杀掉所有会话后再点检测 → 不报错（`activeId` 为 null 守卫）

### 测试 5：maxBuffer 服务端截断（性能）

1. 设置 maxBuffer = 1 MB
2. 在终端跑 `while ($true) { "x" * 1000 }` 持续输出大量内容
3. 等 10 秒后观察服务端：`node` 进程内存占用（任务管理器）
4. **预期**：
   - 服务端内存增长有限（应 < 100 MB 包含 V8 + buffer）
   - 单个会话的 `sessions[id].buffer.length` 不会持续超过 2,000,000
5. 在客户端开新 tab 连 `http://localhost:<端口>`，触发 buffer 回放
6. **预期**：重放数据最多 1 MB（Network 面板看下行 WebSocket 帧大小）

### 测试 6：UTF-8 边界（中文输出）

1. 终端跑 `while ($true) { "你好世界"; Start-Sleep 0.1 }`
2. maxBuffer = 1 MB
3. 等 30 秒后 F12 Console 输入 `terms[activeId].buffer.active.buffer.active.length`（xterm 内部 buffer）
4. **预期**：
   - xterm 显示正常中文，无乱码、无「?」方块
   - 服务端 `sessions[id].buffer.length` 不超过 2,000,000
5. 重连（断网 5 秒后恢复）→ 中文输出仍正常显示

### 测试 7：回归

- 多客户端：另一个浏览器 tab 打开同一服务，确认 list / buffer / 弹窗 / 设置同步
- 重连：断网后重连，弹窗应能正常打开，buffer 检测可用
- 关闭弹窗：弹窗不应阻塞终端交互（终端仍可输入、滚动）
- 快捷键编辑弹窗与设置弹窗都能正常打开/关闭，互不干扰

### 验证清单

- [ ] 布局：body 宽度 = xterm 宽度（DevTools 测量）
- [ ] 顶栏：6 个按钮 + 1 个下拉 + 1 个状态灯，无 input
- [ ] 弹窗：4 块结构完整，样式与快捷键编辑弹窗一致
- [ ] buffer 检测：点击后 1 秒内返回，显示 `X.XX MB / Y.YY MB (Z.Z%)`
- [ ] maxBuffer 应用：服务端 `config.maxBuffer` 更新，磁盘 `config.json` 持久化
- [ ] 截断性能：1 MB maxBuffer + 高输出下，V8 内存可控
- [ ] UTF-8：中文输出无乱码
- [ ] 多客户端：另一 tab 同步设置

## 不在本次范围

- 热键编辑弹窗 UI 改造（与设置弹窗合并？后续讨论）
- 顶栏按钮顺序自定义
- 弹窗拖拽、记忆位置/大小
- 服务端主动推送 buffer 占用（避免无谓广播）
- maxBuffer 实时进度条（需要频繁广播 used）
- 多语言 i18n
- maxBuffer 单位在 MB / 字符之间切换的开关
- buffer 检测的历史曲线
- 弹窗切换动画
- 移除 `@xterm/addon-fit`（已列入 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md) 已知事项 #1，不在本次范围）
