# 输入条动作可配置（多端同步）设计文档

- 日期：2026-07-15
- 状态：已批准，待实现
- 关联：`public/index.html`、`server.js`、`config.json`

## 1. 背景与目标

当前输入条（输入框右边的按钮 + Enter 键）的动作是硬编码的：

- 右侧按钮：固定「换行」（`insertNewline`）
- Enter 键：固定「发送」（`sendInputBar`）
- 发送后：固定「清空内容、保持展开」

用户希望这三项都能在设置弹窗里随时调整，并且**多端同步**（改一处，所有浏览器窗口 + 服务端 `config.json` 一起生效）。

设计原则（来自用户明确反馈）：**严禁过度设计**。不做任何"防呆/逃生通道"（例如不引入 Shift+Enter 兜底）。用户如果把两个动作都配成发送或都配成换行，那是他自己的选择，直接在设置里改回来即可。

## 2. 新增配置项

全部走与现有 `swipe_*` 完全一致的多端同步链路：

`config.json` 字段 → `loadConfig` 默认值+校验 → 连接时 `ws.send` 下发 → ws handler 校验+`saveConfig`+`broadcast` → 前端 `apply*` 只 `wsSend`（服务端权威）→ 前端接收侧更新变量+日志。

| 设置项 | config.json 字段 | 类型 / 取值 | 默认值 | 弹窗控件 |
|---|---|---|---|---|
| 右侧按钮动作 | `inputBarButtonAction` | `'newline'` / `'send'` | `'newline'` | `<select>` + 应用按钮 |
| Enter 键动作 | `inputBarEnterAction` | `'newline'` / `'send'` | `'send'` | `<select>` + 应用按钮 |
| 发送后关闭输入条 | `inputBarCloseAfterSend` | `boolean` | `false`（保持展开） | 勾选框（即时应用） |

默认值刻意等于今天的行为，保证升级后既有使用习惯不变。

## 3. 后端改动（server.js）

### 3.1 `loadConfig()` 默认对象（约 L11-27）
新增三个字段：
```js
inputBarButtonAction: 'newline',
inputBarEnterAction: 'send',
inputBarCloseAfterSend: false,
```

### 3.2 `loadConfig()` 校验（约 L56-62 区域）
在现有字段校验之后追加：
```js
if (cfg.inputBarButtonAction !== 'newline' && cfg.inputBarButtonAction !== 'send') cfg.inputBarButtonAction = 'newline';
if (cfg.inputBarEnterAction !== 'newline' && cfg.inputBarEnterAction !== 'send') cfg.inputBarEnterAction = 'send';
if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
```

### 3.3 连接时下发（约 L198-200 之后）
在 `swipe_classify` / `show_scroll_buttons` 下发之后追加三行：
```js
ws.send(JSON.stringify({ type: 'input_bar_button_action', data: config.inputBarButtonAction }));
ws.send(JSON.stringify({ type: 'input_bar_enter_action', data: config.inputBarEnterAction }));
ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));
```
> 顺序说明：这三个值与 list 处理器无关（不读于 list 处理），按 note 29 规则放在 swipe 设置之后即可，无需前置到 list 之前。

### 3.4 WS 消息处理器（约 L299 之后）
追加三个 `else if` 分支，模式与 `show_scroll_buttons` 一致（校验 → 落盘 → 广播）：
```js
else if (type === 'input_bar_button_action') {
    if (data !== 'newline' && data !== 'send') return;
    config.inputBarButtonAction = data;
    broadcast({ type: 'input_bar_button_action', data: config.inputBarButtonAction });
    saveConfig(config);
}
else if (type === 'input_bar_enter_action') {
    if (data !== 'newline' && data !== 'send') return;
    config.inputBarEnterAction = data;
    broadcast({ type: 'input_bar_enter_action', data: config.inputBarEnterAction });
    saveConfig(config);
}
else if (type === 'input_bar_close_after_send') {
    if (typeof data !== 'boolean') return;
    config.inputBarCloseAfterSend = data;
    broadcast({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend });
    saveConfig(config);
}
```

## 4. 前端改动（public/index.html）

### 4.1 顶层变量（约 L81 之后）
```js
let inputBarButtonAction = 'newline';
let inputBarEnterAction = 'send';
let inputBarCloseAfterSend = false;
```

### 4.2 设置弹窗 HTML（约 L209 之后，紧跟"显示滚动按钮"行之后）
两个下拉框 + 应用按钮，一个勾选框（即时应用）：
```js
// 右侧按钮动作
html += '<div class="modal-row">';
html += '右侧按钮动作 <select id="settingsInputBarButtonActionInput">'
      + '<option value="newline">换行</option><option value="send">发送</option></select>';
html += '<button class="btn-primary" id="btn-apply-inputBarButtonAction" onclick="applySettingsInputBarButtonAction()">应用</button>';
html += '</div>';

// Enter 键动作
html += '<div class="modal-row">';
html += 'Enter 键动作 <select id="settingsInputBarEnterActionInput">'
      + '<option value="newline">换行</option><option value="send">发送</option></select>';
html += '<button class="btn-primary" id="btn-apply-inputBarEnterAction" onclick="applySettingsInputBarEnterAction()">应用</button>';
html += '</div>';

// 发送后关闭输入条
html += '<div class="modal-row">';
html += '<label><input type="checkbox" id="settingsInputBarCloseAfterSendInput" onchange="applySettingsInputBarCloseAfterSend()"> 发送后关闭输入条</label>';
html += '<span id="hint-inputBarCloseAfterSend" class="apply-hint"></span>';
html += '</div>';
```

### 4.3 弹窗值同步（openSettingsModal 内，约 L282 之后）
```js
document.getElementById('settingsInputBarButtonActionInput').value = inputBarButtonAction;
document.getElementById('settingsInputBarEnterActionInput').value = inputBarEnterAction;
document.getElementById('settingsInputBarCloseAfterSendInput').checked = inputBarCloseAfterSend;
```

### 4.4 apply 函数（紧跟 applySettingsShowScrollButtons 之后，约 L420 之后）
枚举类用 `fbBtn` 反馈（与数值设置一致）；布尔勾选用 `flashHint` 即时应用（与 `applySettingsShowScrollButtons` 一致）：
```js
function applySettingsInputBarButtonAction() {
    const v = document.getElementById('settingsInputBarButtonActionInput').value;
    if (v === 'newline' || v === 'send') {
        wsSend({ type: 'input_bar_button_action', data: v });
        fbBtn('btn-apply-inputBarButtonAction', true);
    } else {
        fbBtn('btn-apply-inputBarButtonAction', false);
    }
}
function applySettingsInputBarEnterAction() {
    const v = document.getElementById('settingsInputBarEnterActionInput').value;
    if (v === 'newline' || v === 'send') {
        wsSend({ type: 'input_bar_enter_action', data: v });
        fbBtn('btn-apply-inputBarEnterAction', true);
    } else {
        fbBtn('btn-apply-inputBarEnterAction', false);
    }
}
function applySettingsInputBarCloseAfterSend() {
    const v = document.getElementById('settingsInputBarCloseAfterSendInput').checked;
    wsSend({ type: 'input_bar_close_after_send', data: v });
    flashHint('hint-inputBarCloseAfterSend');
}
```

### 4.5 ws.onmessage 接收侧（紧跟 `show_scroll_buttons` 分支之后，约 L783 之后）
```js
} else if (msg.type === 'input_bar_button_action') {
    inputBarButtonAction = msg.data;
    applyInputBarButtonLabel();
    addFrontendLog('右侧按钮动作同步为 ' + (inputBarButtonAction === 'send' ? '发送' : '换行'), 'in');
} else if (msg.type === 'input_bar_enter_action') {
    inputBarEnterAction = msg.data;
    addFrontendLog('Enter 键动作同步为 ' + (inputBarEnterAction === 'send' ? '发送' : '换行'), 'in');
} else if (msg.type === 'input_bar_close_after_send') {
    inputBarCloseAfterSend = msg.data;
    addFrontendLog('发送后关闭输入条同步为 ' + (inputBarCloseAfterSend ? '关闭' : '保持展开'), 'in');
}
```

### 4.6 行为接线

**右侧按钮分发 + 动态文字**（当前 `inputBarSend` 按钮 `onclick="insertNewline()"` 改为 `onclick="inputBarRightButton()"`）：
```js
// 右侧按钮：按当前设置决定是换行还是发送
function inputBarRightButton() {
    if (inputBarButtonAction === 'send') sendInputBar();
    else insertNewline();
}
// 按钮文字随设置切「换行」/「发送」
function applyInputBarButtonLabel() {
    const btn = document.getElementById('inputBarSend');
    if (btn) btn.textContent = (inputBarButtonAction === 'send') ? '发送' : '换行';
}
```
`applyInputBarButtonLabel()` 在启动时（DOM 就绪后）调用一次，确保初始文字与服务器默认值一致。

**Enter 键行为**（当前 keydown 监听 L1270-1273 改写）：
```js
inputBarText.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); clearInputBar(); }
    else if (e.key === 'Enter') {
        e.preventDefault();
        if (inputBarEnterAction === 'send') sendInputBar();
        else insertNewline();
    }
});
```

**发送后是否关闭**（`sendInputBar` 内 L1262 改写）：
```js
// 原：clearInputBar();  // 清空内容但保持展开
// 改：按设置决定收起还是保持展开
if (inputBarCloseAfterSend) closeInputBar();   // 清空并收起（closeInputBar 默认 clear=true）
else clearInputBar();                          // 清空保持展开
```

### 4.7 占位符文案（小优化，可选）
`inputBarText` 的 `placeholder` 随 Enter 动作变化：Enter=发送 → "输入内容，回车发送，点右侧按钮换行"；Enter=换行 → "输入内容，回车换行，点右侧按钮发送"。在 `applyInputBarEnterAction` 接收侧或 `openInputBar` 内更新一次即可。仅纯视觉提示，不影响逻辑。

## 5. 数据流与边界

- **服务端权威**：所有 `apply*` 只 `wsSend`，本地状态由接收侧 `msg.data` 赋值更新。WebSocket 失败时 `wsSend` 内部静默失败（不抛异常），按钮 `fbBtn`/`flashHint` 仍给出"指令已发出"反馈。
- **连接顺序**：三个新消息在 list 之后下发，不影响 list 处理（不读于 list handler），无需调整 note 29 的顺序约束。
- **空内容**：右侧按钮映射为「发送」且内容为空时，`sendInputBar` 直接 `return`（不发不关），与当前 Enter 行为一致；映射为「换行」且内容为空时，`insertNewline` 保持原「空内容关闭输入条」行为。
- **无新增监听器**：仅复用现有 `keydown` / `blur` / 弹窗控件的内联 handler，新增仅 `inputBarRightButton` / `applyInputBarButtonLabel` 两个纯函数调用，无额外 DOM 节点。

## 6. 性能影响

- 零新增事件监听器、零新增 DOM 节点（弹窗控件为静态 HTML 字符串拼接）。
- 仅现有 handler 内多几次变量读取 + 一次 `textContent` 赋值（按钮标签更新，仅在设置变更/启动时发生，非高频）。
- 可忽略。

## 7. 验收标准

1. 默认配置下，行为与现状完全一致（按钮=换行、Enter=发送、发送后保持展开）。
2. 设置弹窗里把「右侧按钮动作」改成「发送」，按钮文字变「发送」，点击后实际发送；其他客户端同步变「发送」。
3. 把「Enter 键动作」改成「换行」，在输入框按 Enter 插入换行；其他客户端同步。
4. 勾选「发送后关闭输入条」，发送后输入条收起回到快捷键栏；取消勾选则保持展开。
5. 刷新页面 / 重连后，设置从 `config.json` 经服务端下发恢复，按钮文字与行为正确。
6. 配置落盘：`config.json` 出现三个新字段，修改后持久化。

## 8. 文档更新

实现完成后需同步更新 `AGENTS.md` 注意事项（输入条相关 note 35 补充三设置项 + 多端同步链路），并通知用户。
