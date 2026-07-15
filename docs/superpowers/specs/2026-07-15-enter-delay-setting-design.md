# 回车停顿 enterDelayMs 多端同步设置

- 日期：2026-07-15
- 状态：已批准，待写实现计划

## 背景

输入条（底部）发送文本时，`sendInputBar()` 在「整段正文一次性发出」之后、单独发 `\r` 回车之前，有一个硬编码的停顿 `const ENTER_DELAY = 300`（ms），用于模拟手动按 Enter 前的手感（见 `public/index.html:1338` 与 `:1372`）。

该停顿目前写死在代码里，用户无法调整。需求：把它做成设置弹窗里的一个可配置项，并**和其他设置项一样多端同步**（config.json 持久化 + WS 广播给所有客户端）。

> 注：本项目存在两条相互冲突的 feedback 记忆（「所有设置弹窗项都要多端同步」vs「纯前端参数不需要同步」）。本需求由用户在请求中**明确指定多端同步**，故以用户指令为准，采用多端同步方案。

## 设计要点

完全照搬现有 `swipe_threshold` / `input_bar_*` 的端到端链路，不引入新机制。

### 命名

| 项 | 值 |
|----|----|
| `config.json` 字段 | `enterDelayMs`（默认 300） |
| WS 消息类型 | `enter_delay_ms`（C→S 设置 + S→C 广播），snake_case 惯例 |
| 前端全局变量 | `let enterDelayMs = 300` |
| 单位 | ms |

### 取值范围

- 默认 300（与原硬编码行为一致）
- 合法范围 `50 ≤ v ≤ 3000`，`step 50`
- 不允许 0（最小 50ms，保留一点停顿手感）
- 服务端校验：非整数 / 越界 → 拒收（不覆盖、不广播）
- 前端 `applySettingsEnterDelay()` 校验：非整数 / 越界 → `fbBtn(false)`（红色反馈），不发送

### 后端 `server.js`（3 处）

1. **`loadConfig` 默认值**：在 `def` 对象（约 L11-30）加 `enterDelayMs: 300`；在兜底校验区（约 L65 后）加：
   ```js
   if (typeof cfg.enterDelayMs !== 'number' || cfg.enterDelayMs < 50 || cfg.enterDelayMs > 3000) cfg.enterDelayMs = 300;
   ```
2. **连接建立时下发**（约 L209 后追加，顺序无约束，紧跟其他 input_bar/swipe 设置即可）：
   ```js
   ws.send(JSON.stringify({ type: 'enter_delay_ms', data: config.enterDelayMs }));
   ```
3. **`ws.on('message')` 处理器**（约 L331 后追加）：
   ```js
   else if (type === 'enter_delay_ms') {
       if (typeof data !== 'number' || data < 50 || data > 3000) return;
       config.enterDelayMs = data;
       broadcast({ type: 'enter_delay_ms', data: config.enterDelayMs });
       saveConfig(config);
   }
   ```

### 前端 `public/index.html`（5 处）

1. **全局变量**：在 inputBar 变量区（约 L84 后）加 `let enterDelayMs = 300;`
2. **设置弹窗「输入条动作」组**：新增一行 number input +「应用」按钮，沿用 `#btn-apply-*` + `fbBtn` 模式（数值项配「应用」按钮，与 `swipe_threshold` 一致；不配即时应用）：
   ```html
   <div class="modal-row">
     <span class="modal-label">回车停顿 (ms)</span>
     <input type="number" id="settingsEnterDelayInput" min="50" max="3000" step="50" style="width:80px;">
     <button class="btn-primary" id="btn-apply-enterDelay" onclick="applySettingsEnterDelay()">应用</button>
   </div>
   ```
3. **apply 函数**（与其他 apply 同区）：
   ```js
   function applySettingsEnterDelay() {
       const v = parseInt(document.getElementById('settingsEnterDelayInput').value);
       if (Number.isInteger(v) && v >= 50 && v <= 3000) {
           wsSend({ type: 'enter_delay_ms', data: v });
           fbBtn('btn-apply-enterDelay', true);
       } else {
           fbBtn('btn-apply-enterDelay', false);
       }
   }
   ```
4. **`ws.onmessage` 分支**（紧跟 `input_bar_*` 分支之后）：
   ```js
   } else if (msg.type === 'enter_delay_ms') {
       enterDelayMs = msg.data;
       addFrontendLog('回车停顿同步为 ' + enterDelayMs + ' ms', 'in');
   }
   ```
5. **`openSettingsModal` 同步当前值**（约 L341 后）：
   ```js
   document.getElementById('settingsEnterDelayInput').value = enterDelayMs;
   ```

### 行为变化

- `sendInputBar()` 中 `await sleep(ENTER_DELAY)` 改为 `await sleep(enterDelayMs)`；删除 `const ENTER_DELAY = 300` 常量行（`public/index.html:1338`）。
- Enter 键发送（`inputBarEnterAction === 'send'`）与右侧「发送」按钮（`inputBarButtonAction === 'send'`）都走 `sendInputBar()`，停顿同步受 `enterDelayMs` 控制。
- **服务端权威**：`applySettingsEnterDelay()` 只 `wsSend`，本地变量由 `ws.onmessage` 接收侧统一更新（与现有所有 apply 类处理器一致，避免「本地已变但 WS 失败被覆盖」的不一致）。

### 下发顺序

`enterDelayMs` 在 `sendInputBar` 中被读取，与注意事项 29 定义的「影响 list 处理的三变量」（`sizeSlots` / `currentSize` / `clientTailMax`）无关，无需调整 WS 连接时的下发顺序。

## 性能影响

纯设置类改动：
- **DOM**：复用 modal 行模板，零新增常驻节点（弹窗打开时动态生成 1 行）。
- **监听器**：0 新增（`onclick` 内联，沿用现有模式）。
- **布局/回流**：仅设置弹窗打开时一次，无运行时持续开销。
- **内存**：1 个全局 number 变量，可忽略。
- **网络**：仅在用户点「应用」时发 1 条低频 WS 消息 + 服务端广播 1 条给所有客户端。

## 是否需要重启后端

改了 `server.js`（新增 config 字段默认 + 连接下发 + 处理器），**需要 `npm run restart`**。按项目纪律，重启动作由用户执行，AI 仅通知、不擅自重启。

## 验收标准

1. 设置弹窗「输入条动作」组出现「回车停顿 (ms)」行，默认显示 300，min 50 / max 3000 / step 50。
2. 输入 50–3000 内整数点「应用」→ 按钮变绿、日志出现「回车停顿同步为 X ms」、config.json 写入 `enterDelayMs`、其他客户端同步更新。
3. 输入越界/非整数点「应用」→ 按钮变红、不发送、不写盘。
4. 修改设置后通过输入条发送文本，实际停顿时长等于新值（用较大值如 2000 肉眼可感知）。
5. 重启服务器后设置从 config.json 恢复并下发。
6. 删除 `const ENTER_DELAY = 300` 后无残留引用。
