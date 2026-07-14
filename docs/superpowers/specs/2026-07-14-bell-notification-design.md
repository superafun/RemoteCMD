# 终端响铃通知通道设计

## 日期
2026-07-14

## 背景
RemoteCMD 的 WebSocket 协议目前只承载两类信息：
1. 原始 PTY 字节流（`type: 'data'`）
2. 配置/控制类消息（尺寸、快捷键、滚动间隔等）

当后端 PowerShell 进程想主动通知用户时（脚本跑完、告警、长时间任务结束），没有任何通道能把这种“通知意图”单独送到前端浏览器。详情用户可以自己翻终端回看，但前提是他必须知道“有事件发生”才行。

## 目标
增加一个最简、稳定、可靠的通知通道：
- 任何程序只要按终端标准输出 BEL 字符 `\x07`，前端就能感知。
- 前端同时显示 Toast（带终端名）和播放一个短蜂鸣音。
- 不引入新配置、不持久化、不增加用户操作。

## 方案
### 触发约定
使用 ASCII 控制字符 BEL（`\x07`）作为通知信号。这是终端世界几十年的标准约定，PowerShell 里可直接输出：

```powershell
Write-Host "`a"          # 响铃
[Console]::Write("`a")   # 同样输出 \x07
```

> 注意：`[console]::Beep()` 直接调用 Windows 系统蜂鸣器，不经过 PTY 输出，因此**不会**触发本通道。这是设计约束，不处理。

### 数据流

```
PowerShell 进程输出 "...\x07"
  │
  ▼
node-pty onData(d)
  │
  ├─ 检查 d 是否包含 \x07
  │   ├─ 是：过滤掉所有 \x07，剩余数据照常作为 data 消息广播
  │   └─ 同时广播一条 bell 消息：{ type: 'bell', id: sessionId }
  │
  └─ 否：原逻辑不变，只广播 data 消息
        │
        ▼
    前端 ws.onmessage
      ├─ 'data' → term.write()
      └─ 'bell' → showBellToast(id) + playBeep()
```

### 协议变更

**S→C 新增消息类型：**

| type | 字段 | 说明 |
|------|------|------|
| `bell` | `id` | 发出响铃的会话 ID |

**C→S 无新消息类型。**

### 后端改动（server.js）

修改 `createSession` 中的 `ptyProcess.onData` 回调（server.js L126-L133）：

```js
ptyProcess.onData((d) => {
    sessions[newId].buffer += d;
    if (sessions[newId].buffer.length > maxBufferChars * 2) {
        sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
    }
    if (d.includes('\x07')) {
        broadcast({ type: 'bell', id: newId });
        const cleaned = d.replace(/\x07/g, '');
        if (cleaned) broadcast({ type: 'data', id: newId, data: cleaned });
    } else {
        broadcast({ type: 'data', id: newId, data: d });
    }
});
```

**注意：**
- `buffer` 保留原始 `d`（含 `\x07`），重连回放时不丢失任何字节。
- 只有发给 xterm 的 data 消息才过滤 `\x07`，因为 xterm.js 对 BEL 无可见输出，且用户详情自己翻终端看即可。
- 一个 data chunk 里无论有几个 `\x07`，都只发一次 `bell`，避免刷屏。

### 前端改动（public/index.html）

1. **在现有 `<style>` 块内增加 `button.toast` 样式（可选，本次只显示非点击 Toast，可不改）**

   由于最终设计为不可点击，Toast 仍用 `div.toast`，无需额外 CSS。

2. **在 ws.onmessage 处理链中增加 `bell` 分支**

   ```js
   } else if (msg.type === 'bell') {
       showBellToast(msg.id);
       playBeep();
   }
   ```

3. **新增 `showBellToast(id)` 函数**

   ```js
   function showBellToast(id) {
       const s = sessions.get(id);
       if (!s) return;  // 终端已不存在，不显示
       const toast = document.createElement('div');
       toast.className = 'toast toast-success';
       toast.textContent = `终端通知: ${s.name}`;
       document.body.appendChild(toast);
       void toast.offsetHeight;
       toast.classList.add('toast-show');
       setTimeout(() => {
           toast.classList.remove('toast-show');
           setTimeout(() => toast.remove(), 300);
       }, 1500);
   }
   ```

4. **新增 `playBeep()` 函数（Web Audio API）**

   ```js
   let audioCtx = null;
   function playBeep() {
       try {
           if (!audioCtx) {
               audioCtx = new (window.AudioContext || window.webkitAudioContext)();
           }
           const osc = audioCtx.createOscillator();
           const gain = audioCtx.createGain();
           osc.connect(gain);
           gain.connect(audioCtx.destination);
           osc.frequency.value = 1000;
           osc.type = 'sine';
           gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
           gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
           osc.start();
           osc.stop(audioCtx.currentTime + 0.1);
       } catch (e) {
           // 浏览器自动播放策略拒绝时静默失败，不影响 Toast 显示
       }
   }
   ```

## 已知约束

1. `[console]::Beep()` 不触发，因为它直接调用 Windows 音频 API，不输出 `\x07`。
2. 首次访问页面时若用户未与页面交互，浏览器可能拒绝 AudioContext 自动播放，此时蜂鸣不响，但 Toast 仍显示。
3. 每个 `\x07` 只触发一次 `bell` 消息，不会按 `\x07` 个数连发。
4. 无配置开关，不能关闭声音或 Toast。
5. 无持久化，不写入 `config.json`。

## 测试计划

1. 在终端中执行 `Write-Host "\`a"`，观察：
   - 终端显示区域无异常（`\x07` 被过滤）。
   - 右上角出现 Toast：`终端通知: Shell #X`。
   - 听到蜂鸣声（若浏览器允许）。
2. 在多个终端中分别响铃，观察多个 Toast 堆叠显示。
3. 执行 `[console]::Beep()`，确认**不触发** Toast 和蜂鸣。
4. 刷新页面后，确认之前终端输出的 `\x07` 仍可在 buffer 回放中保持（无丢失）。

## 性能影响

- **后端**：每次 `onData` 增加 `d.includes('\x07')` 一次，时间复杂度 O(n)，n 为 chunk 长度；含 `\x07` 时增加一次 `replace` 和最多两次广播。正常使用中响铃频率极低，开销可忽略。
- **前端**：`bell` 处理创建 1 个 Toast 节点、1 个 AudioContext 初始化（仅一次）、1 个 oscillator 和 1 个 gain 节点。无内存泄漏，节点自动销毁。
- **网络**：每个响铃增加一条约 30 字节 JSON 消息，可忽略。

## 协议与行为一致性

- 新消息 `bell` 纯单向 S→C，无确认，无客户端设置，无需 config.json 变更。
- 与现有架构完全兼容：不修改已有 `data`/`buffer` 语义，只新增一条旁路消息。
