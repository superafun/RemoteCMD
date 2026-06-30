# buffer 请求尾部比对去重设计（含增量推送）

## 背景与目标

### 现象

用户在多终端场景下使用本应用时，当存在多个终端且每个终端的 `sessions[id].buffer` 都接近 `maxBufferChars`（默认 10 MB）时：

- 任意一次需要拉 buffer 的时机（首次连接 `createTermInstance`、重连后 `isFirstList` 分支）都会触发 5 个全量 buffer 下行
- 全量 buffer 数据包动辄几十 MB，序列化 + 传输 + 客户端 `term.reset() + term.write()` 都要时间
- 表现：xterm 圈转很久才能填完；多终端并行时尤为明显

### 根本问题

服务端 `sessions[id].buffer` 在断网期间可能：
- **完全没变**（断网期间无 PTY 输出）：客户端其实根本不需要重传
- **变了**（断网期间 PTY 有输出）：客户端需要重传

但当前协议不区分这两种情况，**一律全量发送**。

### 设计方向：客户端发尾 → 服务端比对 → 三档响应 + 等待期间丢弃 data

在 `buffer` 请求中加一个 `tail` 字段（最近 4KB 原始字节），服务端按优先级逐档处理：

1. **`buf.endsWith(tail)` 命中** → 回 `data: ''`（未变更；客户端跳过 `reset + write`）
2. **`lastIndexOf(tail)` 找到** → 回 `data: <增量>, pos: <位置>`（增量推送；客户端只 `term.write(data)` 追加）
3. **以上都不命中** → 回 `data: <全量 buffer>`（全量；客户端 `term.reset() + term.write(data)`）

**关键配套机制**：客户端在发出 buffer 请求后进入"等待 buffer 响应"状态（`pendingBuffer` 集合），期间到达的 `data` 消息**直接丢弃**。原因：
- 服务端 send buffer 响应时 `buf.slice(pos)` 已包含 send 那一刻之前的所有 PTY 数据
- 这些数据已包含在 buffer 响应的 `data` 字段中，丢弃 `data` 消息不会导致内容丢失
- TCP 有序保证：send buffer 响应之后的 broadcast 一定在 buffer 响应之后到达客户端 → 之后到达的 `data` 消息正常 write
- 这样客户端不需要 `clientLengths` 字典、不需要 `overlap` 计算

档 1 和档 3 与原版设计一致；档 2 是新增的增量优化，能进一步减少断网期间有部分输出场景下的数据发送量。

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 客户端尾部来源 | 维护独立的 `clientTails[id]` 变量（每个终端一份） | 与服务端 `sessions[id].buffer` 的字节流严格一致；xterm 渲染态会被转义序列污染，不可比 |
| 尾部传输形式 | 原始字节字符串 | 直观、可调试；4KB 载荷可接受；不需要哈希库 |
| 尾部长度 | 默认 4 KB，可设置（`clientTailMax`） | 4KB 覆盖一屏上下；做成可设置便于调优；仿 `maxBuffer` 走 `config.json` + 设置弹窗 |
| 「未变更」协议 | 复用 `buffer` 消息，`data: ''` | 减少新 type；现有 handler 加分支判断即可 |
| 触发范围 | 所有 `buffer` 请求都带 `tail`（含 `createTermInstance`，发 `''`） | 协议统一；服务端逻辑对称 |
| 协议方向 | 新增 1 个 type（`client_tail_max`），`buffer` 消息加 1 个字段（`tail`），服务端用 `pos` 字段区分档 2（增量）和档 3（全量），`data: ''` 表示未变更 | 最小化协议膨胀 |
| 等待期间 data 处理 | 客户端发送 buffer 请求后，进入"等待 buffer 响应"状态，期间到达的 `data` 消息**直接丢弃**；收到 buffer 响应后退出该状态，后续 data 正常处理 | 不需要 pos 计算 overlap，不需要服务端 pending 状态机，TCP 有序保证不丢不重 |

## 协议形状

### 客户端 → 服务端

**`{type:'buffer', id, tail}`**（`tail` 必填，4KB 原始字节字符串）

| 触发点 | 发送的 tail |
|--------|------------|
| `createTermInstance` 末尾 | `''`（空串；xterm 本来就是空的） |
| list 处理器 `isFirstList` 分支（重连交集） | `clientTails[id]` 的最近 4KB（可能是 `''`） |

**`{type:'client_tail_max', data: number}`**（设置变更时发送，仿 `max_buffer`）

### 服务端 → 客户端

**`{type:'buffer', id, data, pos?}`**（语义扩展，`pos` 是可选字段）：
- 档 1：`buf.endsWith(tail)` 命中 → `data: ''`，`pos` 缺席（客户端 write('') 即空操作）
- 档 2：`lastIndexOf(tail) !== -1`（且不命中档 1）→ `data: buf.slice(i + tail.length)`，`pos: <匹配末尾位置>`（客户端只 write 追加，**不 reset**）
- 档 3：以上都不命中 → `data: <全量 buffer>`（`buf.slice(-maxBufferChars)` 或全 `buf`），`pos` 缺席（客户端 reset+write）

**`pos` 字段的作用**（保留的关键字段）：仅用于区分档 2 和档 3
- `pos` 存在 = 档 2（增量） → 客户端只 `term.write(data)` 追加
- `pos` 缺席 + `data === ''` = 档 1（未变更） → 客户端跳过
- `pos` 缺席 + `data !== ''` = 档 3（全量） → 客户端 `reset + write(data)`

> 注：客户端唯一，`tail` 必填。`buf.endsWith(undefined)` 走 JS 自然语义（`false`），会落到「全量发」分支，相当于「缺字段等价于不匹配」。

**`{type:'client_tail_max', data: number}`**（连接建立时下发 + 客户端设置变更后广播）

### 协议对称性

所有 `buffer` 请求都带 `tail`，`createTermInstance` 也不例外（空串）。`tail` 缺字段按不匹配处理。

## 客户端改动（public/index.html）

### 1. 新增模块级变量

放在 `terms = {}` / `wrappers = {}` 附近：

```javascript
let clientTailMax = 4096;  // 默认值，config.json 加载后会覆盖
// 每个终端最近收到的原始字节（data 消息 + buffer 消息合并），用于 buffer 去重
const clientTails = {};
// 等待 buffer 响应中的终端集合。发送 buffer 请求时把 id 加入，收到 buffer 响应时移除
// 在等待期间收到的 data 消息被丢弃（避免与 buffer 响应的 data 重复）
const pendingBuffer = new Set();
```

### 2. 新增工具函数

```javascript
// 累加每个终端的最近原始字节（按 clientTailMax 裁剪）
function appendClientTail(id, chunk) {
    if (!chunk) return;
    let buf = clientTails[id] || '';
    buf += chunk;
    if (buf.length > clientTailMax) buf = buf.slice(-clientTailMax);
    clientTails[id] = buf;
}

// 封装 buffer 请求：自动带 tail，并把 id 加入 pendingBuffer（等待响应期间 data 消息会被丢弃）
function requestBuffer(id) {
    pendingBuffer.add(id);
    wsSend({ type: 'buffer', id, tail: clientTails[id] || '' });
    showBufferLoading(id);
}
```

### 3. data 消息处理器改造

[public/index.html L538-L541](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L538-L541) 现有：

```javascript
} else if (msg.type === 'data') {
    if (terms[msg.id]) {
        terms[msg.id].write(msg.data);
    }
}
```

改为：

```javascript
} else if (msg.type === 'data') {
    if (terms[msg.id]) {
        if (pendingBuffer.has(msg.id)) {
            // 等待 buffer 响应中，丢弃此 data 消息
            // 原因：服务端 send buffer 响应时 buf.slice(pos) 已包含 send 那一刻之前的所有 PTY 数据
            // 这些 data 消息的内容已包含在 buffer 响应的 data 字段中，写入会导致重复
            // TCP 有序保证：send buffer 响应之后的 broadcast 一定在 buffer 响应之后到达客户端
            //   届时 pendingBuffer.delete(id) 已执行（buffer 响应先到），后续 data 正常处理
            return;
        }
        terms[msg.id].write(msg.data);
        appendClientTail(msg.id, msg.data);
    }
}
```

**关键设计**：
- `pendingBuffer` 在发送 buffer 请求时加入 id，收到 buffer 响应时移除
- 等待期间到达的 data 消息被丢弃，**不会**写入 xterm，**不会**累加到 clientTails
- 收到 buffer 响应后，pendingBuffer 移除 id，后续 data 消息正常处理
- TCP 有序保证：服务端 send buffer 响应之后的 broadcast 一定在 buffer 响应之后到达客户端

### 4. buffer 消息处理器改造（核心：3 档响应）

[public/index.html L531-L537](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L531-L537) 现有：

```javascript
} else if (msg.type === 'buffer') {
    addFrontendLog('缓冲区回放 (' + (names[msg.id] || 'Shell #' + msg.id) + ')');
    if (terms[msg.id]) {
        terms[msg.id].reset();
        terms[msg.id].write(msg.data);
    }
    hideBufferLoading(msg.id);
}
```

改为：

```javascript
} else if (msg.type === 'buffer') {
    // 收到 buffer 响应，退出等待状态
    pendingBuffer.delete(msg.id);
    if (msg.data === '' && msg.pos == null) {
        // 档 1：未变更，跳过 reset + write
        addFrontendLog('缓冲区无变化，跳过回放 (' + (names[msg.id] || 'Shell #' + msg.id) + ')');
    } else if (msg.pos != null && terms[msg.id]) {
        // 档 2：增量推送（pos 存在 = 客户端 xterm 内容与服务端 buf 同步，只追加）
        addFrontendLog(`缓冲区增量 ${msg.data.length} 字节 (${names[msg.id] || 'Shell #' + msg.id})`);
        terms[msg.id].write(msg.data);
        appendClientTail(msg.id, msg.data);
    } else if (msg.data && terms[msg.id]) {
        // 档 3：全量回放（pos 缺席 + data 非空 = 客户端与服务端不同步，需 reset）
        addFrontendLog(`缓冲区全量回放 ${msg.data.length} 字节 (${names[msg.id] || 'Shell #' + msg.id})`);
        terms[msg.id].reset();
        terms[msg.id].write(msg.data);
        appendClientTail(msg.id, msg.data);
    }
    hideBufferLoading(msg.id);
}
```

**简化要点**（相比原 spec）：
- 去掉了 `clientLengths` 字典（不再需要跟踪客户端字节数）
- 去掉了 `overlap = max(0, clientLengths - pos)` 计算（数据在等待期间被丢弃，不会产生重叠）
- 去掉了 `newData = msg.data.slice(overlap)` 截断
- 客户端逻辑简化为：pos 存在 → write；pos 缺席 + data 非空 → reset + write
- **服务端无状态、协议字段保持 pos、客户端逻辑最简**

### 5. createTermInstance 改造

[public/index.html L619-L646](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L619-L646) 现有末尾：

```javascript
wsSend({ type: 'buffer', id: id });
showBufferLoading(id);
```

改为：

```javascript
requestBuffer(id);
```

### 6. list 处理器 isFirstList 分支改造

[public/index.html L508-L517](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L508-L517) 现有：

```javascript
if (isFirstList) {
    isFirstList = false;
    oldTermIds.forEach(id => {
        if (currentIds.includes(id) && terms[id]) {
            wsSend({ type: 'buffer', id: id });
            showBufferLoading(id);
            addFrontendLog('申请已存在终端' + (names[id] || 'Shell #' + id) + '的缓存');
        }
    });
}
```

改为：

```javascript
if (isFirstList) {
    isFirstList = false;
    oldTermIds.forEach(id => {
        if (currentIds.includes(id) && terms[id]) {
            requestBuffer(id);
            addFrontendLog('申请已存在终端' + (names[id] || 'Shell #' + id) + '的缓存');
        }
    });
}
```

### 7. list 处理器 dispose 旧 term 时清理

[public/index.html L490-L505](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L490-L505) 现有：

```javascript
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
        addFrontendLog('删除终端' + (names[id] || 'Shell #' + id));
    }
});
```

在 `delete wrappers[id]` 之后加：

```javascript
delete clientTails[id];
pendingBuffer.delete(id);
```

### 8. client_tail_max 消息处理

[public/index.html L552-L559](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L552-L559) `max_buffer` 之后加：

```javascript
} else if (msg.type === 'client_tail_max') {
    clientTailMax = msg.data;
    // 阈值变更后裁剪已存在的 clientTails 字典
    Object.keys(clientTails).forEach(id => {
        if (clientTails[id].length > clientTailMax) {
            clientTails[id] = clientTails[id].slice(-clientTailMax);
        }
    });
}
```

### 9. 设置弹窗新增「buffer 去重比对长度 (bytes)」

[public/index.html L316-L319](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L316-L319) `maxBuffer` 行之后插入：

```javascript
html += '<div class="modal-row">';
html += 'buffer 去重比对长度 (bytes) <input type="number" id="settingsClientTailMaxInput" min="64" max="65536" step="64" style="width:80px;">';
html += '<button class="btn-primary" onclick="applySettingsClientTailMax()">应用</button>';
html += '</div>';
```

弹窗打开时同步（[public/index.html L346-L351](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L346-L351) 附近）：

```javascript
document.getElementById('settingsClientTailMaxInput').value = clientTailMax;
```

新增应用函数（[public/index.html L405-L412](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L405-L412) `applySettingsMaxBuffer` 之后）：

```javascript
function applySettingsClientTailMax() {
    const v = parseInt(document.getElementById('settingsClientTailMaxInput').value);
    if (Number.isInteger(v) && v >= 64 && v <= 65536) {
        clientTailMax = v;
        wsSend({ type: 'client_tail_max', data: clientTailMax });
        addFrontendLog('buffer 去重比对长度变更为 ' + v + ' 字节');
    }
}
```

## 服务端改动（server.js）

### 1. config.json 缺省值

[server.js L11](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L11) 现有：

```javascript
const def = { rows: 60, cols: 118, hotkeys: {}, scrollStep: 3, scrollInterval: 100, maxBuffer: 10, maxFrontendLogs: 50 };
```

改为：

```javascript
const def = { rows: 60, cols: 118, hotkeys: {}, scrollStep: 3, scrollInterval: 100, maxBuffer: 10, maxFrontendLogs: 50, clientTailMax: 4096 };
```

`loadConfig` 不做合法性验证（前端保证合法值），但加一行防御性默认（避免老用户 config.json 缺字段时 `undefined` 穿透到客户端导致 `appendClientTail` 比较异常）：

```javascript
// 防御性默认：老用户 config.json 缺此字段时避免 undefined
if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;
```

放在 [server.js L29](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L29) 既有 `return cfg;` 之前。

### 2. buffer 消息处理器改造

[server.js L115-L120](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L115-L120) 现有：

```javascript
else if (type === 'buffer' && sessions[id]) {
    const buf = sessions[id].buffer;
    // 上限保护：保证下行不超过 maxBuffer
    const data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
    ws.send(JSON.stringify({ type: 'buffer', id, data }));
}
```

改为：

```javascript
else if (type === 'buffer' && sessions[id]) {
    const buf = sessions[id].buffer;
    const tail = p.tail;
    let data;
    let pos = null;

    if (typeof tail === 'string' && tail !== '') {
        if (buf.endsWith(tail)) {
            // 档 1：未变更
            data = '';
        } else {
            const i = buf.lastIndexOf(tail);
            if (i !== -1) {
                // 档 2：增量推送
                pos = i + tail.length;
                data = buf.slice(pos);
            }
        }
    }
    if (data === undefined) {
        // 档 3：全量（tail 缺/空字符串/lastIndexOf 没找到）
        data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
    }

    // 发送（pos 存在时为增量，缺席时为全量或未变更）
    if (pos === null) {
        ws.send(JSON.stringify({ type: 'buffer', id, data }));
    } else {
        ws.send(JSON.stringify({ type: 'buffer', id, data, pos }));
    }
}
```

### 3. client_tail_max 消息处理

[server.js L142-L147](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L142-L147) `max_buffer` 之后加：

```javascript
else if (type === 'client_tail_max') {
    config.clientTailMax = data;
    broadcast({ type: 'client_tail_max', data: config.clientTailMax });
    saveConfig(config);
}
```

### 4. 连接建立时下发

[server.js L100-L108](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L100-L108) 现有：

```javascript
ws.send(JSON.stringify(buildListMsg()));
ws.send(JSON.stringify({ type: 'resize', id: 0, data: { rows: config.rows, cols: config.cols } }));
ws.send(JSON.stringify({ type: 'hotkeys', data: config.hotkeys }));
ws.send(JSON.stringify({ type: 'scroll_step', data: config.scrollStep }));
ws.send(JSON.stringify({ type: 'scroll_interval', data: config.scrollInterval }));
ws.send(JSON.stringify({ type: 'max_buffer', data: config.maxBuffer }));
ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));
```

在 `max_frontend_logs` 之后加：

```javascript
ws.send(JSON.stringify({ type: 'client_tail_max', data: config.clientTailMax }));
```

## 行为时序

### 场景 A：5 个终端静置 30 秒后重连（核心收益场景）

```
[客户端]                                       [服务端]
旧 ws.onclose
   ↓
1s 后 setTimeout → connect()
   └─ new WebSocket()
       ws.onopen 触发
         └─ isFirstList = true                  connection 处理器
                                                  ├─ ws.send(list)              ──→ onmessage: list
                                                  │                                 └─ 既有 diff:
                                                  │                                     - 新 ID（重连后其他客户端新建的） → createTermInstance
                                                  │                                       └─ requestBuffer(id)（tail: ''） ──→ onmessage: buffer × N
                                                  │                                            └─ 全量 buffer（与旧行为等价）
                                                  │                                     - 旧 ID 缺失 → dispose
                                                  │                                 └─ 关键: isFirstList 为 true
                                                  │                                    对 diff 前双方都有的 ID:
                                                  │                                    requestBuffer(id)（tail: 4KB） ──→ onmessage: buffer × N
                                                  │                                 isFirstList = false
                                                  │                                    服务端对每个 id:
                                                  │                                      buf.endsWith(tail) 全部命中
                                                  │                                       └─ ws.send({type:'buffer', id, data: ''}) × 5
                                                  │                                          ──→ onmessage: buffer × 5
                                                  │                                            └─ data === '' → 跳过 reset+write
                                                  │                                            └─ hideBufferLoading(id) × 5
                                                  │                                            ✓ loading 圈几乎同时消失
                                                  ├─ ws.send(resize)              ──→ onmessage: resize
                                                  ├─ ...
                                                  ├─ ws.send(client_tail_max)     ──→ onmessage: client_tail_max
                                                  │                                 └─ clientTailMax 同步
                                                  └─ 后续 ptyProcess.onData         broadcast(data)            ──→ onmessage: data
                                                                                                                └─ term.write() + appendClientTail ✓
```

总下行量：5 个 `data: ''` 消息（几十字节）替代 5 个 10MB buffer（50MB），节省 >99% 带宽，等待时间从几十秒降到 <100ms。

### 场景 B：首次连接（验证向后兼容）

```
list 到达 → terms 为空 → createTermInstance
  └─ requestBuffer(id)（tail: ''） → 服务端走全量分支（与旧行为等价）
```

新 term 由 `requestBuffer` 填满，行为与本次改动前完全相同。

### 场景 C：重连时断网期间有 PTY 输出

```
list 到达 → 既有 diff → createTermInstance + isFirstList 分支
  └─ requestBuffer(id)（tail: 4KB）→ 服务端 buf.endsWith(tail) 不匹配
       └─ 全量发 → 客户端 reset + write + appendClientTail
       └─ 看到断网期间输出（与旧行为等价）
```

### 场景 D：重连时服务端新增 term（其他客户端创建）

```
list 到达 → 新 ID → createTermInstance
  └─ requestBuffer(id)（tail: ''）→ 全量发 → 填满新 xterm
```

新 term 由 `createTermInstance` 路径走（`tail: ''`），与旧行为等价。

### 场景 E：客户端调大 clientTailMax

```
设置弹窗 → applySettingsClientTailMax() → ws.send({type:'client_tail_max', data: 16384})
                                                                                ↓
                                                              broadcast(client_tail_max)
                                                                                ↓
                                                              所有客户端收到 → clientTailMax = 16384
                                                                                ↓
                                                              已存在的 clientTails 字典按新阈值裁剪
                                                                                ↓
                                                              后续 buffer 请求 tail 变长，命中率略升
```

## 不变量

- `clientTails[id].length ≤ clientTailMax`（每次 `appendClientTail` 后裁剪）
- `pendingBuffer` 集合元素 = 当前等待 buffer 响应的终端 id（发送请求时 add，收到响应时 delete）
- 等待期间到达的 `data` 消息**不**写入 xterm，**不**累加到 clientTails
- 服务端 `sessions[id].buffer.length ≤ 2 * maxBufferChars`（既有滞回式不变）
- 所有 `{type:'buffer'}` 请求由 `requestBuffer` 封装发出，强制带 `tail` 字段 + 加入 pendingBuffer

## 边界情况

| 场景 | 行为 | 可接受 |
|------|------|--------|
| 首次连接 createTermInstance | `tail:''` → 服务端走档 3 全量分支 → 与旧行为等价 | ✓ |
| 重连时两端都有 term 且内容无变化 | 档 1：`endsWith` 命中 → `data:''` → 客户端跳过 reset+write | ✓ 核心收益 |
| 重连时两端都有 term 且断网期间有输出 | 档 2：`lastIndexOf` 命中 → 增量推送（`data: <delta>, pos`）→ 客户端只追加 | ✓ 增量收益 |
| 重连时两端都有 term 且 tail 找不到匹配 | 档 3：全量发 → 客户端 reset+write | ✓ 兜底 |
| 断网期间 buffer 触发 2x 滞回截断 + tail 在新 buf 末尾 | 档 1 命中 → `data:''` | ✓ |
| 断网期间 buffer 触发 2x 滞回截断 + tail 在新 buf 中段 | 档 2 命中 → 增量推送截断后的剩余部分 | ✓ |
| 断网期间 buffer 触发 2x 滞回截断 + tail 找不到 | 档 3 全量发 | ✓ 兜底 |
| 重连时服务端新增 term（其他客户端创建） | 由 `createTermInstance` 路径走（`tail:''` → 档 3） | ✓ |
| 客户端 `clientTailMax` 调小 | `clientTails` 字典中已有数据不裁剪；后续 push 自然按新阈值裁剪 | ✓ |
| 客户端 `clientTailMax` 调大 | 后续 push 按新阈值保留更多 | ✓ |
| 客户端 `data` 消息丢失（极罕见） | `clientTails` 落后于服务端 → 不匹配 → 全量发 | ✓ 正确 |
| 5 个终端全部命中去重（档 1） | 5 个 `data:''` 几乎同时到达 → 5 个 loading 圈几乎同时消失 | ✓ |
| 5 个终端全部走档 2 | 5 个 `data: <delta>, pos` 几乎同时到达 → 各自追加 → loading 圈消失 | ✓ |
| 5 个终端部分档 1 部分档 2 | 混合处理，各自独立 | ✓ |
| `data:''` 误识别为 buffer 真的为空 | 不会发生：服务端 `buf` 至少有 PowerShell 提示符（几百字节）才收到 buffer 请求（list 必先到） | ✓ |
| 多客户端各自独立 `clientTails` | 每客户端独立维护；服务端不存客户端状态，无竞争 | ✓ |
| `maxBufferChars` 因 maxBuffer 调整而变化 | 服务端后续发的 buffer 是按新阈值截取的；客户端收到后用新数据覆盖 `clientTails` 末尾 | ✓ |
| 重连期间 PTY 进程死了（buffer 没了） | `buf` 变空，tail 不匹配 → 档 3 全量发空 → 客户端 reset + write('') → xterm 空 | ✓ |
| **客户端在 buffer 请求与响应间收到 `data` 消息** | **客户端 `pendingBuffer.has(id)` 为 true → data 处理器 return 丢弃**；服务端 send buffer 响应时 `buf.slice(pos)` 已包含 send 那一刻之前的所有 PTY 数据，所以**不丢失** | ✓ 关键设计 |
| **服务端 send buffer 响应之后产生的 PTY 数据** | **TCP 有序保证**：send 之后的 broadcast 一定在 buffer 响应之后到达客户端；客户端处理 buffer 响应时 `pendingBuffer.delete(id)` 退出等待状态；后续 data 消息正常 write | ✓ 不丢失 |
| `lastIndexOf` 误匹配病理（如 `abcabcab`） | pos 偏后，delta 偏短；客户端只 write（不 reset），xterm 内容 = 旧内容 + 部分新增；`endsWith` 不命中所以走不到档 1 | △ 已知极限 |

## 通信协议变化

| 方向 | type | 变化 |
|------|------|------|
| 客户端 → 服务端 | `buffer` | **新增字段** `tail`（4KB 原始字节字符串） |
| 客户端 → 服务端 | `client_tail_max` | **新增**：`data` 是 number |
| 服务端 → 客户端 | `buffer` | **新增语义**：`data === ''` 表示未变更（档 1）；新增 `pos` 字段表示增量起始位置（档 2）；档 3 不带 `pos` 表示全量 |
| 服务端 → 客户端 | `client_tail_max` | **新增**：`data` 是 number |
| 其他 | — | 不变 |

### `buffer` 消息服务端 → 客户端 状态机

| 服务端分支 | `data` | `pos` | 客户端动作 |
|----------|--------|-------|-----------|
| 档 1（endsWith 命中） | `''` | 缺席 | `pendingBuffer.delete(id)` 退出等待，跳过 reset+write，hideBufferLoading |
| 档 2（lastIndexOf 命中） | `<增量>` | `<pos>` | `pendingBuffer.delete(id)` 退出等待，`term.write(data)` 追加，appendClientTail，hideBufferLoading |
| 档 3（兜底） | `<全量或截断>` | 缺席 | `pendingBuffer.delete(id)` 退出等待，`term.reset() + term.write(data)`，appendClientTail，hideBufferLoading |

## 改动文件清单

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) | +18 行 / 改 6 行 / 删 0 行 | `buffer` 处理器重写为 3 档分支（endsWith / lastIndexOf / 兜底全量）；新增 `client_tail_max` 处理器 + 连接建立时下发；`config.json` 缺省值加字段 |
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | +30 行 / 改 5 处 / 删 0 行 | 新增 `clientTails` 字典 + `pendingBuffer` 集合 + `clientTailMax` 变量 + `appendClientTail` + `requestBuffer`；`data` 处理器开头判断 `pendingBuffer.has(id)` 决定是否丢弃；`buffer` 处理器改造为 3 档响应（用 pos 字段区分档 2 增量/档 3 全量）；`createTermInstance`/list 处理器 isFirstList 分支改造；list dispose 清理（同时清 `pendingBuffer`）；`client_tail_max` 处理器；设置弹窗新增输入项 |
| `config.json` | +1 字段 | `clientTailMax: 4096`（首次启动时由 server.js 写入；老用户文件不变，无字段时前端用默认值 4096） |

## 测试

项目无测试框架（见 [AGENTS.md](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/AGENTS.md)），采用手动测试。

### 测试 1：首次连接，验证向后兼容

1. 启动服务 `node server.js`
2. 打开页面，确认终端正常显示 PowerShell 提示符
3. **预期**：`tail:''` → 全量发 → xterm 填满（与旧行为等价）

### 测试 2：核心收益场景 —— 5 个终端静置重连

1. 启动服务，客户端创建 5 个终端，每个运行 `while($true){Get-Date;Start-Sleep 1}`（持续输出）
2. 等 30 秒让 buffer 累积（每个 ~2KB）
3. Chrome DevTools → Network 面板 → Offline
4. 取消 Offline，触发重连
5. **预期**：
   - 5 个 `data:''` 几乎同时到达
   - 5 个 loading 圈几乎同时消失（<100ms）
   - xterm 内容保持不变（跳过 reset+write）
   - 后续 `data` 消息无缝接上

### 测试 3：断网期间有输出（验证档 2 增量推送）

1. 启动服务，创建一个终端，运行 `while($true){Get-Date;Start-Sleep 1}`（每 1 秒 1 行输出，约 30 字节/秒）
2. Chrome DevTools → Network → Offline
3. 等待 30 秒（断网期间服务端 buffer 累积 ~900 字节）
4. 取消 Offline
5. **预期**：
   - 服务端 `endsWith(tail) = false`（断网期间有新数据）
   - 服务端 `lastIndexOf(tail) = 找到位置`（走档 2）
   - 客户端收到 `data: <~900 字节 delta>, pos: <某位置>`
   - 客户端只 `term.write(delta)`（追加，不 reset）
   - xterm 显示断网期间所有输出，无重复、无丢失
   - Network 面板下行 payload 远小于全量 buffer（~900 字节 vs 之前累积的 10MB+）

### 测试 3.5：等待期间 data 消息被丢弃

1. 启动服务，创建一个终端，运行 `1..1000 | ForEach-Object { Write-Output $_; Start-Sleep 0.01 }`（快速输出）
2. Chrome DevTools → Network → Offline
3. 立即取消 Offline（断网窗口极短，模拟「客户端在 buffer 请求与响应间收到 data 消息」的竞争条件）
4. **预期**：
   - 客户端可能走档 2 增量
   - 等待期间到达的 `data` 消息被 `pendingBuffer` 拦截丢弃（不写入 xterm、不累加到 clientTails）
   - 收到 buffer 响应时 `pendingBuffer.delete(id)` 退出等待
   - 之后到达的 `data` 消息（服务端 send buffer 响应之后的 PTY 数据）正常 write
   - 终端内容**无重复、无丢失**
   - 不会出现「1\n1\n2\n2」这种重复

### 测试 4：极端 buffer 大小

1. 启动服务，创建 5 个终端，每个跑满 8MB 输出
2. 静置断网 5 秒后重连
3. **预期**：
   - 5 个终端的 tail 都命中（断网期间无新输出）
   - 5 个 `data:''` 同时到达；loading 圈几乎同时消失
   - 节省 ~40MB 下行带宽

### 测试 5：调小 clientTailMax

1. 启动服务，打开页面，打开设置弹窗
2. 把「buffer 去重比对长度」改成 1024，应用
3. 观察服务端 console：`[broadcast] client_tail_max: 1024`
4. 观察前端日志：「buffer 去重比对长度变更为 1024 字节」
5. 触发重连，验证 tail 变短（命中率略降，但连接正常）

### 测试 6：调大 clientTailMax

1. 类似测试 5，改成 16384
2. 验证 tail 变长

## 升级路径

**本次实施即完整方案**，无后续阶段。

如果实施后用户报告「buffer 累积很大但 tail 仍然命中」这类假阳性（理论上 SHA-256 才会碰撞，原始字符串比对不会碰撞，所以不太可能），可考虑：
- 加大 tail 默认值（8KB 或 16KB）
- 引入 server-side 行级 hash（每行算哈希，tail 比对哈希数组）

但本次不实施。

## 不在本次范围

- 服务端 diff 协议（按行/字节序号；本设计已通过原始字符串比对解决 99% 场景）
- 服务端主动推 buffer（与现有 ptyData broadcast 模型冲突）
- 服务端对 `clientTailMax` 做合法性检查（前端 input 限制保证）
- `loadConfig` 对 `clientTailMax` 做合法性验证（仅加一行 `null` 防御性默认；不验证范围）
- 缺 `tail` 字段时关闭连接 / warn / 错误码（客户端唯一，不存在不合法请求；按 JS 自然语义 `buf.endsWith(undefined) === false` 落到「全量发」分支）
- 改动 1Hz 状态轮询、心跳探测、xterm 重建等其他机制
- 服务端对 `clientTails` 做服务端版本缓存（每客户端独立，无竞争需求）
- 任何向后兼容机制（软件未发布，客户端/服务端唯一版本）
