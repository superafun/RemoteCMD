# 输入条逐字符发送修复 设计文档

- 日期：2026-07-13
- 关联需求：底部「输入条」的「发送」按钮，效果需等同于底部 Enter 快捷键（即把文本敲进终端后按一次回车确认）。
- 范围：纯前端改动（`public/index.html`），不动 `server.js`、不加 WebSocket 消息。刷新网页即生效。

## 1. 问题

当前 `sendInputBar()`（`public/index.html:933`）把整段文本拼接成**一个字符串、一条** WebSocket 消息一次性发出：

```js
sendInput(t.replace(/\n/g, '\r') + '\r');
```

现象（用户反馈）：
- 普通 PowerShell 提示符下，「发送」= 回车，正常。
- 进入 **TUI 程序**后，「发送」被解释为「换行」，而底部 Enter 快捷键仍是「确认/执行」。

根因：很多 TUI 把"一次性灌入的一大段字节"当作粘贴/缓冲文本处理，其中的 `\r` 被当成字段内换行；而底部 Enter 快捷键发出的是**单独一条** `\r` 消息，TUI 把它当作一次真实的按键事件 = 确认。

结论：两者的字节内容都是 `\r`，差异在于**发送粒度**——整段一条 vs 逐字符多条。

## 2. 目标

让「发送」按钮的行为等价于真人打字：把文本（含末尾 `\r`）**一个字符一条消息**地发送出去，字符间加一个很小的人为延时，使 TUI 把每个字符都当成独立按键事件，`\r` 回到"确认"语义，与 Enter 快捷键一致。

## 3. 方案

### 3.1 改动点

仅修改 `public/index.html` 中的 `sendInputBar()` 函数，并新增一个 `sleep` 辅助函数和一个 `TYPING_DELAY` 常量。

### 3.2 新逻辑

```js
// 逐字符发送时每个字符之间的延时（ms），模拟真人敲键节奏；如需更慢/更快改这里
const TYPING_DELAY = 15;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendInputBar() {
    const t = inputBarText.value.replace(/\n+$/, '');   // 去末尾换行，避免多发空行
    if (!t) { closeInputBar(); return; }                 // 空内容：仅关闭不发送
    const targetId = activeId;                            // 捕获目标会话，防止发送途中切换会话
    const seq = t.replace(/\n/g, '\r') + '\r';            // \n→\r 并补末尾回车
    closeInputBar();                                      // 先收起输入条、把焦点交还终端
    addFrontendLog('输入条发送: ' + t, 'out');
    for (const ch of seq) {
        if (!targetId) break;                             // 捕获时无活动会话（activeId 为 null）则不发送
        wsSend({ type: 'input', id: targetId, data: ch });
        await sleep(TYPING_DELAY);
    }
}
```

### 3.3 设计要点

1. **保留现有预处理**：`\n`→`\r` 转换、去末尾换行、空内容仅关闭不发送，行为不变。
2. **逐字符发送**：拼接出完整序列 `seq = 文本.replace(/\n/g,'\r') + '\r'`，用 `for...of` 逐字符发送，每个字符各一条独立 `input` 消息。
3. **目标会话捕获**：发送前捕获 `targetId = activeId`，发送时直接 `wsSend({type:'input', id: targetId, ...})`，避免在 ~0.75s 的逐字符发送过程中若用户切换会话，导致剩余字符跑到别的终端。
4. **`closeInputBar()` 先调用**：与现版一致（发完即关），且先 `sessions.get(activeId)?.focus()` 把焦点交还终端，移动端软键盘不收回；文本已捕获到 `t`，清空 `inputBarText.value` 不影响发送。
5. **`TYPING_DELAY` 常量**：固定 15ms，单一易调常量。50 字符命令约 0.75s，属"打字"可接受范围。
6. **断续保护**：循环内 `if (!targetId) break` 仅保护「捕获时无活动会话（`activeId` 为 null）」情形；真正断连时 `targetId` 仍为原数字，`wsSend` 内部 `readyState===1` 检查会静默丢弃该消息，无需额外处理。

### 3.4 不改动的部分

- `server.js`：仍是既有的 `input` 消息 → `pty.write(data)` 逐条写入，无需改动。
- WebSocket 协议：不发新消息类型。
- 底部 Enter 快捷键、`发按键` 面板、其他发送路径均不变。

## 4. 性能影响

- **消息量**：命令 10–50 字符 = 10–50 条 `input` 消息（原 1 条）。每条仅一次 `wsSend` + 一次 `setTimeout`，无新增 DOM 节点、无新增事件监听器。
- **延时**：`TYPING_DELAY=15ms`，长命令累积延时在亚秒级，属预期"打字"节奏，非性能问题。
- **内存**：`sleep` 用 `Promise`/`setTimeout`，无持续持有对象；`seq` 为短字符串，循环结束即释放。
- **执行频率**：仅点击「发送」时触发，非高频路径。

## 5. 验收

1. 普通 PowerShell 提示符：输入条填 `Get-Date` 点发送 → 命令执行并出结果（与回车一致）。
2. 进入 TUI（如 `choice` / 任意读取逐键输入的菜单程序）：输入条填内容点发送 → 与按底部 Enter 键效果一致（确认/执行），不再替换成换行。
3. 空输入条点发送 → 仅收起、不发送、不出日志噪音。
4. 发送途中切换终端 → 剩余字符仍发往原终端，不串台。
5. 安卓真机：点发送后软键盘不收回（焦点已交还终端）。

## 6. 范围外（YAGNI）

- 不做可配置发送速度（保持单一常量，用户需要再提）。
- 不做"粘贴模式"（bracketed paste `\x1b[200~`...`\x1b[201~`），与需求方向相反——需求正是要模拟真人逐键。
- 不动 `server.js` 与协议。
