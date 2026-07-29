# 输入条长命令报错修复：改为一次性整段发送 + 回车分离

日期：2026-07-14
状态：已评审通过

## 1. 问题

用户通过底部输入条发送一长串文字（单行长命令）时，TUI 常常在发送中途报错：

```
windows ctrl+v may block large input for large paste. use alt+v for fast paste
```

但用右键粘贴同样的长文本却正常。

## 2. 根因（代码级事实 + TUI 行为推断）

### 2.1 已确认的代码事实

数据最终都汇聚到 `server.js:167` 的 `sessions[id].pty.write(data)`，但两条路径的写入形态不同：

- **右键粘贴**（`term-session.js:31` 的 `term.onData` → `wsSend({type:'input', id, data: 整段})`）：整段文本在**一条** WebSocket `input` 消息里发出，服务端执行**一次** `pty.write(整段)`。TUI 在一次 `read()` 中拿到一大块连续数据。
- **输入条**（`index.html:1010` 的 `sendInputBar`）：`for...of` 逐字符循环，每字符一条独立 WebSocket `input` 消息、间隔 `TYPING_DELAY=15ms`，服务端对应执行 **N 次** `pty.write(单字符)`。TUI 每 15ms 才在 `read()` 中拿到 1 个字符。

报错文本不在本仓库代码中（已 grep 确认），是用户运行的 TUI 自身吐出。

### 2.2 推断的 TUI 行为（高置信，属 TUI 内部逻辑）

TUI（raw 模式）内部有两种输入模式，由"输入是怎么到达的"触发：

| 模式 | 触发条件 | 对长文本 | 收到 `\r` 时 |
|------|----------|---------|-------------|
| **粘贴/快速模式** | 输入是一大块"连续灌入"（一次 read 拿到一大坨） | 绕过行长上限，长命令不报错 | 当成**字段内换行**（粘贴多行应留在框内，不提交） |
| **逐键交互模式** | 输入是一个个离散按键 | 走行编辑器，长跑长度上限报错 | 当成**确认/执行**（手动敲了回车） |

`\r`（0x0D）只是"回车键"这个字节。它是"换行"还是"执行"**不是字节自身决定的，而是由 TUI 当前模式决定**，而模式由输入到达的方式（blob vs 离散按键）决定。这与 AGENTS.md 注意事项 35 的原话一致：

> TUI 把"整段一次性灌入"当粘贴/缓冲文本，`\r` 被解释成字段内换行；而底部 Enter 快捷键是单独一条 `\r` 消息，TUI 当作真实按键=确认。

### 2.3 为什么右键能用、输入条不行

- 右键 → 一次大块 `read()` → TUI 进入粘贴/快速模式 → 长命令绕过长度上限 → 正常。
- 输入条 → 每 15ms 一个字符的离散 `read()` → TUI 始终在逐键交互模式 → 长命令超过行编辑器长度上限 → 跑到"一半"触发保护报错。

当初引入逐字符发送（注意事项 35）是为了让 `\r` 被当成"逐键回车=确认"，但这把长文本锁死在逐键交互模式，长命令从而撞上限。

### 2.4 为什么回车要与正文分离，且 `\n` 必须换成 `\r`

- **回车分离**：若把 `正文 + 末尾 \r` 作为一个 blob 一次性发出，TUI 在粘贴模式下会把末尾 `\r` 也当"字段内换行"，**不会执行**（即注意事项 35 的坑）。因此正文（不含末尾回车）整段一次性发出走粘贴模式，之后单独延迟 ~300ms 再发一个独立 `\r`，让 TUI 把它当一次手动按键 = 确认/执行。
- **`\n`→`\r`**：真实终端的回车键产生的是 `\r`（0x0D）；`\n`（0x0A）是文本文件行结束符，不是键盘字节。TUI（raw 模式）的输入解析器只认 `\r` 作换行信号。若不替换，草稿里的 `\n` 进 TUI 后可能被忽略（多行合并成一行）、被当未知控制字符、或在少数把 `\n` 归一为 Enter 的库里被误判成"提前执行"。故发送前统一把 `\n` 翻译成 `\r`。

## 3. 方案：正文一次性整段发送 + 回车分离（方案 A + 回车分离）

仅修改 `public/index.html` 的 `sendInputBar()`：

1. 正文（`\n` 已归一为 `\r`，**不含**末尾回车）作为**一条** `wsSend({type:'input', id, data: textSeq})` 发出 → 与右键粘贴同路径（单次 `pty.write`），TUI 走粘贴/快速模式。
2. 延迟 `ENTER_DELAY=300ms` 后，单独发一条 `wsSend({type:'input', id, data: '\r'})` → 模拟手动敲 Enter = 确认/执行。

### 3.1 改动后的 `sendInputBar()`

```js
const ENTER_DELAY = 300;   // 正文发完后、单独发回车前的停顿（ms），模拟手动按 Enter

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendInputBar() {
    const t = inputBarText.value.replace(/\n+$/, '');   // 去末尾换行，避免多发空行
    if (!t) { return; }                                  // 空内容：不发送、不关闭
    const targetId = activeId;                            // 捕获目标会话，防止发送途中切换会话串台
    const textSeq = t.replace(/\n/g, '\r');              // 正文内容，\n→\r，不含末尾回车
    clearInputBar();                                      // 清空内容但保持展开，焦点仍在输入框
    addFrontendLog('输入条发送: ' + t, 'out');
    if (!targetId) return;                               // 捕获时无活动会话则不发送
    wsSend({ type: 'input', id: targetId, data: textSeq });  // 整段正文一次性发出
    await sleep(ENTER_DELAY);                            // 停顿，模拟手动按 Enter 前的手感
    wsSend({ type: 'input', id: targetId, data: '\r' });     // 单独发回车 = 确认/执行
}
```

要点：
- 正文一次发出，`\n`→`\r` 归一语义保留；**末尾回车不再并入正文 blob**。
- 回车作为独立消息在 `ENTER_DELAY` 后发出，模拟人工"粘贴完再敲 Enter"。
- `targetId` 先捕获，发送途中切换会话不串台（虽已两条消息，`if (!targetId)` 仍保护"捕获时无活动会话"）。
- `换行`按钮（`insertNewline`）只往 textarea 插入 `\n` 编辑草稿、**从不发送**；发送时的 `\n`→`\r` 只是字节翻译，多行文本照样能发（内部 `\r` = 字段内换行，最后独立 `\r` = 执行）。

### 3.2 清理/新增常量

- 删除 `const TYPING_DELAY = 15;`（`index.html:997`）—— 逐字符循环移除后不再有任何引用。
- 保留并重用 `function sleep(ms)`（`index.html:999`）—— 现用于 `ENTER_DELAY` 停顿。
- 新增 `const ENTER_DELAY = 300;` —— 回车前的停顿。
- grep 确认：`TYPING_DELAY` 仅存在于 `sendInputBar` 与文档中，删除安全；`sleep` 仅 `sendInputBar` 使用。

### 3.3 不动的部分

- `server.js`：无需改动。`input` 消息处理逻辑（`sessions[id].pty.write(data)`）天然支持任意长度单条数据（右键粘贴已证明）。
- WebSocket 协议：不加新消息类型。
- 右键粘贴、Ctrl+V 粘贴、底部快捷键、发按键面板：均不受影响。

## 4. 性能影响

- **改动前**：N 条 WebSocket 消息 + N 次 `pty.write` + N 次 15ms 定时器，墙钟 N×15ms（如 300 字符 ≈ 4.5s）。
- **改动后**：2 条 WebSocket 消息（正文 + 回车）+ 2 次 `pty.write` + 1 个 300ms 定时器，墙钟 ≈ 300ms。
- **净效果**：消息数与墙钟耗时从 O(N) 降到 O(1)；DOM 操作量、事件监听数、布局回流均无变化。正面优化。
- **超大单条风险**：`ws` 库默认单消息上限 100MB；node-pty 对超长 `write` 内部排队；右键粘贴已同路径验证，无新增风险。

## 5. 验收

1. 启动服务器（`Get-NetTCPConnection -LocalPort <端口>` 确认在跑则用现成服务；只改前端不重启）。
2. Android 真机 / 桌面浏览器连上终端，打开输入条，粘贴/输入一条**很长的命令**（之前会中途报错的那种长度）。
3. 回车发送：正文整段进入 TUI、**停顿约 300ms 后**命令被执行，**不再出现** `windows ctrl+v may block large input...` 报错。
4. 对比右键粘贴同一长命令：行为一致（都不报错）；回车分离的 300ms 停顿在真机手感上接近人工操作。
5. 浏览器控制台（F12）无红字报错；前端日志（`设置`→`日志`）能看到 `输入条发送: <内容>` 一条记录（不再是逐字符多条）。

## 6. 范围外（YAGNI）

- 多行 TUI 表单填值场景（`\r` 必须当逐键确认、不能当粘贴内换行）：用户确认不再需要，故不做"打字模式"开关（即不做方案 C）。
- 不 rebuild/优化 `server.js`、不引入新协议。

## 7. 配套更新

- 更新 `AGENTS.md` 注意事项 35：标注输入条已改为"正文一次性整段发送 + 回车分离（ENTER_DELAY=300ms）"（与右键粘贴同路径），移除逐字符/TYPING_DELAY 描述，新增本注意事项说明根因与修复。
