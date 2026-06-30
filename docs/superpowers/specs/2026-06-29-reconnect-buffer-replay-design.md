# 重连后 xterm 增量更新 + 现有 term 拉 buffer 设计

## 背景与目标

### 现象

用户在前端使用本应用时，如果遇到网络信号抖动（例如移动端进入电梯、地铁、信号切换等场景），前端 WebSocket 与服务端的连接会断开。当网络恢复、客户端自动重连成功后，会出现以下症状：

- 状态指示灯显示「已连接」
- 在终端里输入字符能正常发送（上行通）
- 但**实际控制台已经在持续产生新输出，网页却没有任何更新**（下行不通）
- 看起来就像终端被卡住了，必须手动刷新整个页面才能恢复

### 根本问题

服务端 `sessions[id].buffer` 在断网期间一直在累积（按 `config.maxBuffer` 截断，默认 50000 字符），内容是完整的。但**重连成功后，客户端从来没有要求服务端把这段 buffer 发过来**。

直接后果：用户在断网期间产生的所有终端输出，**永久丢失**，看起来就像"终端卡住不动"。

### 设计方向：diff-based 增量更新

经过反思和权衡，最优雅的方案是**保留现有 xterm 实例，按 diff 增量更新**：

1. **既有的 `list` 处理器**已经在做 diff：服务器多了的 ID → `createTermInstance`；服务器没有的 ID → dispose
2. **重连后**（即重连后的第一个 `list`），对**客户端有、服务器也有的 term**（即 diff 交集），发 buffer 请求拉最新内容更新
3. **其他情况不拉 buffer**：避免在 `session create` 这类常规 list 时把已存在的 term 误刷导致页面闪烁

这样既保证"两端都有的 term"在重连后能看到断网期间内容，又不会产生不必要的闪烁（无 DOM 重建、无 wrapper 重建、无 addon 重新加载，只有 xterm 内部 `reset + write`）。

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 修复范围 | 仅前端改动 | 服务端现有 `buffer` 请求处理器（[server.js:95](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L95)）可直接复用 |
| buffer 拉取时机 | 重连后**第一个** `list` 处理器内 | 避免 `session create` 这类常规 list 把旧 term 也刷一遍导致闪烁 |
| 拉取范围 | diff 交集（`currentIds ∩ Object.keys(terms)`） | 用户明确要求"对于客户端有服务器也有的xterm"才拉 |
| 第一次 list 的判定 | `isFirstList` 标志位，`ws.onopen` 时重置为 true | 唯一可靠的事件钩子，与现有 1s 轮询兼容 |
| 新 term 的 buffer 来源 | **保留** `createTermInstance` 中的 `ws.send({type:'buffer'})`（[public/index.html:314](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L314)） | 按职责对称：createTermInstance 创建 xterm 就该负责把它填满；新 term 不会被 `data` 流错过任何服务端已积累的内容 |
| buffer 处理方式 | 维持既有 `term.reset() + term.write(buffer)` | 复用现有逻辑；现有 term 有 `reset` 才能清掉旧内容 |
| 是否保留 activeId | 保留（与现状一致） | list 处理器中 `if (!activeId && currentIds.length > 0)` 分支只会在 activeId 被 dispose 时才切换 |
| 升级路径 | 留文档说明，但不实现 | 若实施后仍有"完全卡死"报告，再加心跳 |

## 根因分析

### 现状代码链路

[public/index.html:222](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L222) `list` 消息处理器：

```javascript
if (msg.type === 'list') {
    if (msg.names) names = msg.names;
    const currentIds = msg.ids.map(String);
    currentIds.forEach(id => {
        if (!terms[id]) {              // ← 关键判断
            createTermInstance(id);    // ← 只在 term 不存在时才调
        }
    });
    // ... (后续处理 disposed 的 term 和 activeId)
}
```

[public/index.html:314](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L314) 是当前**唯一**发出 `{type:'buffer'}` 请求的地方，且只存在于 `createTermInstance` 内部。

### 时序对比

**首次连接**：

```
list 到达 → terms 为空 → if (!terms[id]) 命中 → createTermInstance
  └─ 内含 ws.send({type:'buffer', id})  →  buffer 回来 → reset + write
```

**重连（bug 现场）**：

```
list 到达 → terms[id] 已存在 → if (!terms[id]) 不命中 → 跳过 createTermInstance
  └─ buffer 请求从未发出                                          ✗ 永远不重发
```

`data` 消息的 broadcast 一直在跑（PTY 进程没死），所以**新数据是有的**，但**断网期间的数据被永久跳过**。

### 修复思路

在 `list` 处理器中，**diff 完成后**，对**diff 之前双方都有的 term**发 buffer 请求（带 `isFirstList` 守卫）。这样：

- **不破坏职责对称**：`createTermInstance` 仍然负责"新 xterm 创建后立刻拉 buffer 填满"；`list` 处理器负责"重连后给双方都有的旧 xterm 拉 buffer 补回断网期间内容"
- **不需要新增服务端代码**（buffer 协议已存在）
- **不误刷**：`isFirstList` 守卫确保 `session create` / `kill` 这类常规 list 不会触发对旧 term 的 buffer 拉取
- **保留所有内容**：新 term 不会被 `data` 流错过服务端已积累的内容

## 行为时序（修复后）

### 场景 A：重连（主要修复场景）

```
[客户端]                                       [服务端]
旧 ws.onclose
   ↓
1s 后 setInterval → connect()
   └─ new WebSocket()
       ws.onopen 触发
         └─ isFirstList = true                  connection 处理器
                                                  ├─ ws.send(list)              ──→ onmessage: list
                                                  │                                 └─ 既有 diff:
                                                  │                                     - 新 ID（重连后其他客户端新建的） → createTermInstance
                                                  │                                       └─ 内含 ws.send({type:'buffer'})  ──→ onmessage: buffer
                                                  │                                            └─ term.reset() + term.write()  ← 新 xterm 填满
                                                  │                                     - 旧 ID 缺失 → dispose
                                                  │                                 └─ 关键: isFirstList 为 true
                                                  │                                    对 diff 前双方都有的 ID:
                                                  │                                    ws.send({type:'buffer', id})  ──→ onmessage: buffer × N
                                                  │                                 isFirstList = false
                                                  │                                    └─ term.reset() + term.write()  ✓  ← 断网期间内容回放
                                                  ├─ ws.send(resize)              ──→ onmessage: resize
                                                  ├─ ws.send(hotkeys)             ──→ ...
                                                  ├─ ws.send(scroll_step)         ──→ ...
                                                  └─ ws.send(max_buffer)          ──→ ...
                                                  后续 ptyProcess.onData             broadcast(data)            ──→ onmessage: data
                                                                                                                └─ term.write() ✓ 无缝接力
```

**两类 buffer 请求**（互不冲突，各司其职）：
- 新 ID：来自 `createTermInstance`，作用是"把新 xterm 填满"
- 交集 ID：来自 list 处理器的 isFirstList 分支，作用是"重连后回放断网期间内容"

### 场景 B：首次连接

```
[客户端]                                       [服务端]
onopen 触发
  └─ isFirstList = true                          connection 处理器
                                                  ├─ ws.send(list)              ──→ onmessage: list
                                                  │                                 └─ 既有 diff: 全部为新 ID
                                                  │                                     - createTermInstance × N
                                                  │                                       └─ 内含 ws.send({type:'buffer'})  ──→ onmessage: buffer × N
                                                  │                                            └─ term.reset() + term.write()  ← 新 xterm 填满
                                                  │                                 └─ isFirstList 为 true 但 currentIds ∩ Object.keys(terms) 为空
                                                  │                                    （diff 前 terms 是空的）→ 不再额外发 buffer 请求
                                                  │                                 isFirstList = false
                                                  ├─ ws.send(resize)              ──→ ...
                                                  └─ 后续 ptyProcess.onData         broadcast(data)            ──→ onmessage: data
                                                                                                                └─ term.write()  ← 持续追加
```

`createTermInstance` 内部的 buffer 请求已经覆盖了首次连接的所有新 xterm；isFirstList 守卫在交集为空时不重复发请求。

### 场景 C：已有连接下创建新会话

```
[客户端 A]                                 [服务端]                       [客户端 B]
ws.send({type:'create'})
                                            createSession()
                                              ├─ newId = sessionCounter++
                                              ├─ pty.spawn(...)
                                              ├─ sessions[newId] = ...
                                              └─ broadcast(list)         ──→ onmessage: list  ──→ onmessage: list
                                                                              既有 diff:
                                                                                - 新 ID → createTermInstance
                                                                                  └─ 内含 ws.send({type:'buffer'})  ──→ onmessage: buffer
                                                                                       └─ term.reset() + term.write()  ← 新 xterm 填满
                                                                                - 旧 ID 都在 → 不动
                                                                              isFirstList 为 false
                                                                                → 不再额外发 buffer 请求  ← 关键：旧 term 不会被误刷
                                                                              后续 data 流        ──→ ...
```

旧的 term 不被重置，不闪烁；新 term 由 `createTermInstance` 自带的 buffer 请求填满。

### 场景 D：已有连接下 kill 会话

```
[客户端 A]                                 [服务端]                       [客户端 B]
ws.send({type:'kill', id: '2'})
                                            sessions[2].pty.kill()
                                            sessions[2] 删除
                                            broadcast(list)         ──→ onmessage: list  ──→ onmessage: list
                                                                              既有 diff:
                                                                                - 旧 ID '2' 不在 currentIds → dispose
                                                                                - 其他 ID 都在 → 不动
                                                                              isFirstList 为 false
                                                                                → 不发 buffer 请求  ← 关键：其他 term 不闪烁
```

被 kill 的 term 被 dispose；其他 term 不闪烁。

## 前端改动（public/index.html）

### 1. 在模块顶部添加 isFirstList 标志位

在 `pendingCreate` 声明附近（[public/index.html:188](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L188) 附近）添加：

```javascript
let isFirstList = true;  // 重连后的第一个 list 标志，用于触发 buffer 增量拉取
```

### 2. 在 connect() 的 ws.onopen 中重置标志

[public/index.html:215](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L215) 处的 `connect()` 函数，在 `new WebSocket(...)` 之后、现有 `ws.onclose` 之前，添加：

```javascript
ws.onopen = () => {
    // 重连后第一个 list 标志重置，让 list 处理器对 diff 交集发 buffer 请求
    isFirstList = true;
};
```

完整改后的 `connect()` 形态：

```javascript
function connect() {
    if (!ws || ws.readyState === 3) {
        console.log('重新连接服务器');
        ws = new WebSocket(`${wsProtocol}://${location.host}/cmd/`);
        ws.onopen = () => {
            // 重连后第一个 list 标志重置，让 list 处理器对 diff 交集发 buffer 请求
            isFirstList = true;
        };
        ws.onclose = () => { pendingCreate = false; };
        ws.onmessage = (event) => {
            // ... 既有逻辑完全不变 ...
        };
    }
}
```

### 3. 在 list 处理器中加 diff 交集 buffer 请求

[public/index.html:222](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L222) 处的 `list` 处理器，在 diff 之后（创建新 term 之后、dispose 旧 term 之后）、activeId 处理之前，添加：

```javascript
if (msg.type === 'list') {
    if (msg.names) names = msg.names;
    const currentIds = msg.ids.map(String);
    const oldTermIds = Object.keys(terms);  // 关键: diff 之前的 term 集合快照

    // 既有 diff 逻辑：创建新 term
    currentIds.forEach(id => {
        if (!terms[id]) {
            createTermInstance(id);
        }
    });

    // 既有 dispose 逻辑：删除被 kill 的 term
    Object.keys(terms).forEach(id => {
        if (!currentIds.includes(id)) {
            if (terms[id]) {
                terms[id].dispose();
                delete terms[id];
            }
            if (wrappers[id]) {
                wrappers[id].remove();
                delete wrappers[id];
            }
            if (activeId === id) {
                activeId = null;
            }
        }
    });

    // 新增: 重连后第一个 list，对 diff 交集（即双方都有的 term）发 buffer 请求
    // 常规 session create / kill 的 list 不会进入此分支，避免误刷旧 term 导致闪烁
    if (isFirstList) {
        isFirstList = false;
        oldTermIds.forEach(id => {
            if (currentIds.includes(id) && terms[id]) {
                ws.send(JSON.stringify({ type: 'buffer', id: id }));
            }
        });
    }

    // 既有 activeId 处理（不变）
    if (!activeId && currentIds.length > 0) {
        switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
    }
}
```

### 4. createTermInstance 保持不变

[public/index.html:294](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L294)→[320](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L320) 的 `createTermInstance` 函数**完全不动**，包括其中既有的 `ws.send(JSON.stringify({ type: 'buffer', id: id }))`。

按职责对称：createTermInstance 负责创建 xterm 并把它填满。任何时候调用 createTermInstance，xterm 都是空的，都需要服务端 buffer 把它填到最新状态：

- **首次连接时**：新 xterm 创建后立刻拉 buffer，得到 PowerShell 提示符等
- **重连时其他客户端新建的会话**：新 xterm 创建后立刻拉 buffer，得到断网期间服务端已经积累的全部内容
- **本客户端点击「新建终端」时**：新 xterm 创建后立刻拉 buffer，得到新会话的初始状态

### 不变的部分

- 服务端完全不动
- `createTermInstance` 函数完全不动（继续负责"创建 xterm + 拉 buffer 填满"）
- `buffer` 消息处理器不变（仍是 `term.reset() + term.write()`）
- 1s 轮询、状态灯、`onclose` 行为均不变
- `data` 消息处理不变

## 边界情况

| 场景 | 行为 | 是否可接受 |
|------|------|----------|
| 首次连接 | `isFirstList` 为 true 但 `currentIds ∩ Object.keys(terms)` 为空（diff 前 terms 空），不发 buffer；新 term 由 `createTermInstance` 内的 buffer 请求填满 | ✓ |
| 重连 | `isFirstList` 在 `onopen` 中被重置；list 处理器对 diff 交集发 buffer；`isFirstList = false`；新 ID 由 `createTermInstance` 填满 | ✓ 正是要修的 |
| 重连时服务端有更多会话 | 交集是原有 term，全部拉 buffer 更新断网期间内容；新 term 由 `createTermInstance` 填满 | ✓ |
| 重连时服务端有更少会话 | 交集是共有 term，全部拉 buffer 更新；被杀 term 被 dispose | ✓ |
| 重连时所有服务端会话都消失 | 交集为空，不发 buffer；服务端 `connection` 处理器检测到无会话会 `createSession()` | ✓ 既有行为 |
| 已有连接下创建新会话 | `isFirstList` 为 false，不发 buffer；新 term 由 `createTermInstance` 填满；旧 term 不闪烁 | ✓ 关键 |
| 已有连接下 kill 会话 | `isFirstList` 为 false，不发 buffer；被杀 term 被 dispose；其他 term 不闪烁 | ✓ 关键 |
| 多个客户端同时重连 | 各自独立 `onopen`，各自处理 `isFirstList` | ✓ |
| 客户端切换到已存在的 term | `switchSession` 仅切换显示，不发任何消息；term 中已有最新内容 | ✓ |
| 客户端切换到刚被其他客户端创建的新 term | 该 term 已通过 `createTermInstance` 的 buffer 请求填满 | ✓ |
| buffer 响应晚于 `data` 消息 | `term.reset() + term.write(buffer)` 会清掉已经写入的 `data`，再用更新的 buffer 重写 | ✓ 正确（buffer 是更新的） |
| buffer 响应早于 `data` 消息 | `term.write(buffer)` 写入 buffer 内容；后续 `data` 消息直接 append | ✓ 正确 |
| 多次快速断开/重连 | 每次 `onopen` 都重置 `isFirstList`；每次重连后的第一个 list 都触发一次 buffer 拉取 | ✓ 幂等 |
| `xterm.reset()` 抛错 | xterm.js 的 dispose 同步执行；万一抛错会被冒泡到 list 处理器外，浏览器忽略；下次 list 到达时 `terms[id]` 仍存在 | ✓ 健壮 |
| `isFirstList` 初始值 | 页面加载时为 true，首次 list 处理时如果没有交集则置 false（不发请求），无副作用 | ✓ |
| `pendingCreate` 行为 | 维持现状：仅在 `createNew()` 末尾置 true，在 createTermInstance 末尾消费 | ✓ 不变 |

## 改动文件清单

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [server.js](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js) | **0 改动** | 复用现有 `buffer` 请求处理器（[server.js:95](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L95)） |
| [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) | +9 行 / 改 0 行 / 删 0 行 | 新增 `isFirstList` 标志；`ws.onopen` 加重置；list 处理器加 6 行交集判断 + buffer 请求 |

总计前端净 +9 行，1 个文件，**服务端零改动**。

## 通信协议变化

**无变化**。本设计完全复用现有的 WebSocket 协议，buffer 请求本来就有（来自 `createTermInstance`），只是在 list 处理器中新增了一个**带守卫的**发送入口：

| 方向 | type | 变化 |
|------|------|------|
| 服务端 → 客户端 | `list` / `buffer` / `resize` / `hotkeys` / `scroll_step` / `max_buffer` / `data` | 不变 |
| 客户端 → 服务端 | `buffer` | **新增一个发送入口**：list 处理器在 `isFirstList` 为 true 时对 diff 交集发请求；`createTermInstance` 内的既有发送逻辑保留 |
| 客户端 → 服务端 | 其他（`create` / `input` / `kill` / `resize` / `hot_keys` / `scroll_step` / `max_buffer` / `rename` / `rename_all`） | 不变 |

## 测试

项目无测试框架（见 [AGENTS.md](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\AGENTS.md)），采用手动测试。

### 测试 1：硬重启服务端

1. 启动服务 `node server.js`
2. 打开页面，确认终端正常显示 PowerShell 提示符（验证首次连接 + 新 term 由 `createTermInstance` 拉 buffer 填满）
3. 运行持续输出命令：`while ($true) { Get-Date; Start-Sleep 1 }`
4. 任务管理器结束 `node.exe`
5. 重新 `node server.js`
6. **预期**：页面 xterm 立即显示从断网时刻起的所有内容（最多 `maxBuffer` 字符），然后无缝接上新的实时输出
7. **关键验证**：观察页面**不应有 wrapper 重建闪烁**（term 容器内原有的 wrapper 应该保持，xterm 内部 reset + write 即可）

### 测试 2：Chrome DevTools 离线模拟

1. 启动服务，打开页面，终端运行持续输出命令
2. F12 → Network 面板 → 勾选「Offline」
3. 等待 30 秒以上
4. 取消「Offline」
5. **预期**：xterm 立即补齐 30 秒内错过的内容；页面不应有明显重建闪烁

### 测试 3：跨客户端新建会话（验证不误刷旧 term）

1. 客户端 A 打开页面，在某个 term 里运行 `Get-Process`（产生一些输出）
2. 客户端 B 打开页面（同一服务）
3. 客户端 A 点击「新建终端」
4. **预期**：
   - 客户端 A 和 B 都立即看到新终端
   - 客户端 A 中**原有的 term 内容不被刷新**（无闪烁），新 term 由 `createTermInstance` 拉 buffer 填满

### 测试 4：跨客户端 kill 会话（验证不闪烁）

1. 客户端 A 打开页面，创建两个 term
2. 客户端 B 也打开同一服务，切换到第一个 term 并运行 `Get-Process`
3. 客户端 A 在第一个 term 上点击「关闭」按钮（kill 会话 #1）
4. **预期**：
   - 会话 #1 被 kill
   - 客户端 A 和 B 都会看到 list 处理器清理掉 #1
   - 客户端 B 中**会话 #2 的内容不被刷新**（无闪烁）

### 测试 5：状态灯观察

- 整个断网/重连过程中，状态灯应从「已连接」→「已断连」→「已连接」
- 重连成功后 1 秒内应能看到 buffer 回放导致的 xterm 内容更新

### 回归测试

- 首次连接：开新页面，应正常显示（验证新 term 由 `createTermInstance` 拉 buffer 填满与原行为等价）
- 主动 kill 终端：操作流程不变
- 多终端：每个都应被 list 处理器的 diff 逻辑和 `createTermInstance` / `isFirstList` 正确处理

## 升级路径（暂不实现）

如果实施后用户仍然报告「xterm 完全不动」那种完全卡死的现象，按以下顺序加：

### 阶段 2：心跳探测

- 客户端每 30s 发 `{type:'ping'}`，服务端回 `{type:'pong'}`
- 5s 内没收到 pong 视为僵尸，主动 `ws.close()` 触发 `onclose`，让 1s 轮询重建
- 服务端 `wss.on('connection')` 增加 `if (type === 'ping') ws.send(JSON.stringify({type:'pong'}))` 分支

### 阶段 3：xterm 重建机制

- 阶段 2 实施后若仍偶发完全卡死：心跳连续 N 次失败后 `dispose` 所有 xterm 实例 + 清空 `terms` 与 `wrappers` + 主动调一次"等同于 `list` 触发"的重建流程
- 本设计的 `list` 处理器逻辑可以自然兼容这种"主动全删重建"扩展点（只需在重建后强制重置 `isFirstList`）

这两阶段都不在本设计的实施范围内。

## 不在本次范围

- 心跳探测（升级路径阶段 2）
- xterm 重建机制（升级路径阶段 3）
- 服务端主动推 buffer（避免你担心的"两边信息打架"）
- 改 1s 轮询为事件驱动重连
- 加上 `ws.onerror` 处理器
- buffer 长度超过 xterm 滚动区时的优化
- 任何新增的消息类型
- 任何服务端代码改动
- 移除 `createTermInstance` 内的 buffer 请求（按职责对称应保留）
