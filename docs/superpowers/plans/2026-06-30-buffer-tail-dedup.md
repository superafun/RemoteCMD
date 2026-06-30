# buffer 请求尾部比对去重 + 增量推送 实现计划

> **For agentic workers:** 步骤使用 checkbox (`- [ ]`) 语法追踪进度。

**Goal:** 客户端发送 buffer 请求时附带 tail，服务端按 endsWith/lastIndexOf/兜底 三档响应；客户端在等待 buffer 响应期间丢弃 data 消息，避免重复写入。

**Architecture:** 单文件项目。后端 server.js 处理 buffer 消息的三档分支（保留 pos 字段发回）；前端 public/index.html 新增 `pendingBuffer` 集合（等待期间丢弃 data 消息）+ `clientTails` 字典（用于生成 tail）+ `clientTailMax` 配置（设置弹窗可调）。

**Tech Stack:** Node.js + node-pty + ws（后端）；xterm.js v6 + 原生 JS（前端）；PM2 进程管理。

**项目约束**（来自 AGENTS.md）：
- 无测试框架、无 linter、无 formatter
- 无 git 仓库
- `@xterm/addon-fit` 依赖未使用
- 端口 65433 硬编码
- 配置文件：`config.json`
- 客户端→服务端的 hotkey type 是 `hot_keys`（下划线）

**改动文件**：
| 文件 | 改动量 | 性质 |
|------|--------|------|
| [server.js](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js) | +15 行 / 改 1 处 | `buffer` 处理器重写为三档分支（保留 pos 字段）；新增 `client_tail_max` 处理器 + 连接建立时下发；`config.json` 缺省值加 `clientTailMax: 4096` 字段 + `loadConfig` 加防御性默认 |
| [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) | +20 行 / 改 5 处 | 新增 `clientTails` 字典 + `pendingBuffer` 集合 + `clientTailMax` 变量 + `appendClientTail` + `requestBuffer`；`data` 处理器开头判断 `pendingBuffer.has(id)` 决定是否丢弃；`buffer` 处理器开头 `pendingBuffer.delete(id)` 退出等待 + 三档响应（用 pos 区分档 2/3）；`createTermInstance`/list 处理器 isFirstList 分支改造为 `requestBuffer`；list dispose 清理 `pendingBuffer`；`client_tail_max` 处理器；设置弹窗新增输入项 |
| `config.json` | +1 字段 | `clientTailMax: 4096`（首次启动时由 server.js 写入；老用户文件不变，无字段时前端用默认值 4096） |

---

## Task 1: 后端 - config.json 缺省值添加 clientTailMax

**Files:**
- Modify: [server.js:11](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L11)

- [ ] **Step 1.1: 修改 def 对象**

定位到 `server.js` 第 11 行：

```javascript
const def = { rows: 60, cols: 118, hotkeys: {}, scrollStep: 3, scrollInterval: 100, maxBuffer: 10, maxFrontendLogs: 50 };
```

改为：

```javascript
const def = { rows: 60, cols: 118, hotkeys: {}, scrollStep: 3, scrollInterval: 100, maxBuffer: 10, maxFrontendLogs: 50, clientTailMax: 4096 };
```

- [ ] **Step 1.2: loadConfig 加防御性默认**

定位到 `server.js` 第 28 行 `return cfg;` 之前，添加：

```javascript
    // 防御性默认：老用户 config.json 缺此字段时避免 undefined
    if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;
```

完整 `loadConfig` 函数尾部应类似：

```javascript
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const def = { rows: 60, cols: 118, hotkeys: {}, scrollStep: 3, scrollInterval: 100, maxBuffer: 10, maxFrontendLogs: 50, clientTailMax: 4096 };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(def, null, 2));
        return def;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // 迁移：旧 maxBuffer 字段是字符数（如 10000），新格式是 MB（如 10）
    // 检测规则：值 >= 1000 视为旧字符数（10 MB = 10,000,000 字符远大于 1000）
    if (typeof cfg.maxBuffer === 'number' && cfg.maxBuffer >= 1000) {
        const mb = Math.round(cfg.maxBuffer / 1000000);
        cfg.maxBuffer = (mb >= 1 && mb <= 90) ? mb : 10;
        console.log(`[migration] maxBuffer 自动从字符数转换为 ${cfg.maxBuffer} MB`);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
    // 兜底：缺失或非法值
    if (typeof cfg.maxBuffer !== 'number' || cfg.maxBuffer < 1 || cfg.maxBuffer > 90) {
        cfg.maxBuffer = 10;
    }
    // 防御性默认：老用户 config.json 缺此字段时避免 undefined
    if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;
    return cfg;
}
```

---

## Task 2: 后端 - buffer 消息处理器改造（核心：三档分支）

**Files:**
- Modify: [server.js:115-120](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L115)

- [ ] **Step 2.1: 重写 buffer 处理器**

定位到 `server.js` 第 115-120 行：

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

---

## Task 3: 后端 - 新增 client_tail_max 消息处理 + 连接建立时下发

**Files:**
- Modify: [server.js:107-108](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L107)（连接建立时下发）
- Modify: [server.js:148-152](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/server.js#L148)（max_frontend_logs 处理器之后）

- [ ] **Step 3.1: 连接建立时下发 client_tail_max**

定位到 `server.js` 第 107-108 行：

```javascript
    ws.send(JSON.stringify({ type: 'max_buffer', data: config.maxBuffer }));
    ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));
```

在 `max_frontend_logs` 之后加一行：

```javascript
    ws.send(JSON.stringify({ type: 'max_buffer', data: config.maxBuffer }));
    ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));
    ws.send(JSON.stringify({ type: 'client_tail_max', data: config.clientTailMax }));
```

- [ ] **Step 3.2: 新增 client_tail_max 消息处理**

定位到 `server.js` 第 148-152 行（`max_frontend_logs` 处理器之后）：

```javascript
        else if (type === 'max_frontend_logs') {
            config.maxFrontendLogs = data;
            broadcast({ type: 'max_frontend_logs', data: config.maxFrontendLogs });
            saveConfig(config);
        }
```

在 `max_frontend_logs` 之后加：

```javascript
        else if (type === 'client_tail_max') {
            config.clientTailMax = data;
            broadcast({ type: 'client_tail_max', data: config.clientTailMax });
            saveConfig(config);
        }
```

---

## Task 4: 前端 - 新增模块级变量

**Files:**
- Modify: [public/index.html:234](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L234) 附近（isFirstList 声明后）

- [ ] **Step 4.1: 添加 clientTailMax/clientTails/pendingBuffer 声明**

定位到 `public/index.html` 第 234 行 `let isFirstList = true; ...` 之后（`let settingsDiv = null;` 之前），添加：

```javascript
        let isFirstList = true;  // 重连后第一个 list 标志，用于触发 diff 交集的 buffer 增量拉取
        let clientTailMax = 4096;  // 默认值，config.json 加载后会覆盖
        // 每个终端最近收到的原始字节（data 消息 + buffer 消息合并），用于 buffer 去重
        const clientTails = {};
        // 等待 buffer 响应中的终端集合。发送 buffer 请求时把 id 加入，收到 buffer 响应时移除
        // 在等待期间收到的 data 消息被丢弃（避免与 buffer 响应的 data 重复）
        const pendingBuffer = new Set();
        let settingsDiv = null;  // 设置弹窗 DOM 句柄
```

---

## Task 5: 前端 - 新增工具函数（appendClientTail 和 requestBuffer）

**Files:**
- Modify: [public/index.html:239](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L239) 附近（showBufferLoading 之前/之后）

- [ ] **Step 5.1: 在 showBufferLoading 之后添加工具函数**

定位到 `public/index.html` 第 251 行（`hideBufferLoading` 函数之后，`addFrontendLog` 之前），添加：

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

---

## Task 6: 前端 - data 消息处理器改造（添加 pendingBuffer 检查）

**Files:**
- Modify: [public/index.html:538-541](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L538)

- [ ] **Step 6.1: data 处理器加 pendingBuffer 拦截**

定位到 `public/index.html` 第 538-541 行：

```javascript
                    } else if (msg.type === 'data') {
                        if (terms[msg.id]) {
                            terms[msg.id].write(msg.data);
                        }
                    } else if (msg.type === 'resize') {
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
                    } else if (msg.type === 'resize') {
```

---

## Task 7: 前端 - buffer 消息处理器改造（三档响应 + 退出等待）

**Files:**
- Modify: [public/index.html:531-537](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L531)

- [ ] **Step 7.1: buffer 处理器改造**

定位到 `public/index.html` 第 531-537 行：

```javascript
                    } else if (msg.type === 'buffer') {
                        addFrontendLog('缓冲区回放 (' + (names[msg.id] || 'Shell #' + msg.id) + ')');
                        if (terms[msg.id]) {
                            terms[msg.id].reset();
                            terms[msg.id].write(msg.data);
                        }
                        hideBufferLoading(msg.id);
                    } else if (msg.type === 'data') {
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
                    } else if (msg.type === 'data') {
```

---

## Task 8: 前端 - list 处理器 isFirstList 分支改造 + dispose 清理

**Files:**
- Modify: [public/index.html:506-517](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L506)（isFirstList 分支）
- Modify: [public/index.html:490-505](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L490)（dispose 旧 term 块）

- [ ] **Step 8.1: isFirstList 分支用 requestBuffer**

定位到 `public/index.html` 第 508-517 行：

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

- [ ] **Step 8.2: dispose 旧 term 时清理 clientTails 和 pendingBuffer**

定位到 `public/index.html` 第 490-505 行（dispose 块）：

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

在 `delete wrappers[id];` 之后、`if (activeId === id)` 之前加：

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
                                delete clientTails[id];
                                pendingBuffer.delete(id);
                                if (activeId === id) {
                                    activeId = null;
                                }
                                addFrontendLog('删除终端' + (names[id] || 'Shell #' + id));
                            }
                        });
```

---

## Task 9: 前端 - createTermInstance 末尾用 requestBuffer

**Files:**
- Modify: [public/index.html:638-639](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L638)

- [ ] **Step 9.1: createTermInstance 末尾改造**

定位到 `public/index.html` 第 637-639 行：

```javascript
            addFrontendLog('新建终端' + (names[id] || 'Shell #' + id) + '并申请缓存');
            wsSend({ type: 'buffer', id: id });
            showBufferLoading(id);
```

改为：

```javascript
            addFrontendLog('新建终端' + (names[id] || 'Shell #' + id) + '并申请缓存');
            requestBuffer(id);
```

---

## Task 10: 前端 - client_tail_max 消息处理

**Files:**
- Modify: [public/index.html:558-559](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L558)（max_frontend_logs 处理器之后）

- [ ] **Step 10.1: 添加 client_tail_max 处理器**

定位到 `public/index.html` 第 558-559 行：

```javascript
                    } else if (msg.type === 'max_frontend_logs') {
                        maxFrontendLogs = msg.data;
                    } else if (msg.type === 'restart_server') {
```

改为：

```javascript
                    } else if (msg.type === 'max_frontend_logs') {
                        maxFrontendLogs = msg.data;
                    } else if (msg.type === 'client_tail_max') {
                        clientTailMax = msg.data;
                        // 阈值变更后裁剪已存在的 clientTails 字典
                        Object.keys(clientTails).forEach(id => {
                            if (clientTails[id].length > clientTailMax) {
                                clientTails[id] = clientTails[id].slice(-clientTailMax);
                            }
                        });
                    } else if (msg.type === 'restart_server') {
```

---

## Task 11: 前端 - 设置弹窗新增 clientTailMax 输入项

**Files:**
- Modify: [public/index.html:322-325](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L322)（maxFrontendLogs 行之后）
- Modify: [public/index.html:351](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L351)（弹窗打开时同步值）
- Modify: [public/index.html:421](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L421)（applySettingsMaxFrontendLogs 之后添加新函数）

- [ ] **Step 11.1: 设置弹窗 HTML 中添加新行**

定位到 `public/index.html` 第 322-325 行：

```javascript
            // 日志上限 (条)
            html += '<div class="modal-row">';
            html += '日志上限 (条) <input type="number" id="settingsMaxFrontendLogsInput" min="10" max="10000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" onclick="applySettingsMaxFrontendLogs()">应用</button>';
            html += '</div>';
```

在 `</div>` 之后加：

```javascript
            // 日志上限 (条)
            html += '<div class="modal-row">';
            html += '日志上限 (条) <input type="number" id="settingsMaxFrontendLogsInput" min="10" max="10000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" onclick="applySettingsMaxFrontendLogs()">应用</button>';
            html += '</div>';

            // buffer 去重比对长度 (bytes)
            html += '<div class="modal-row">';
            html += 'buffer 去重比对长度 (bytes) <input type="number" id="settingsClientTailMaxInput" min="64" max="65536" step="64" style="width:80px;">';
            html += '<button class="btn-primary" onclick="applySettingsClientTailMax()">应用</button>';
            html += '</div>';
```

- [ ] **Step 11.2: 弹窗打开时同步 clientTailMax 值**

定位到 `public/index.html` 第 351 行：

```javascript
            document.getElementById('settingsMaxFrontendLogsInput').value = maxFrontendLogs;
```

改为：

```javascript
            document.getElementById('settingsMaxFrontendLogsInput').value = maxFrontendLogs;
            document.getElementById('settingsClientTailMaxInput').value = clientTailMax;
```

- [ ] **Step 11.3: 添加 applySettingsClientTailMax 函数**

定位到 `public/index.html` 第 421 行（`applySettingsMaxFrontendLogs` 函数之后）：

```javascript
        function applySettingsMaxFrontendLogs() {
            const v = parseInt(document.getElementById('settingsMaxFrontendLogsInput').value);
            if (Number.isInteger(v) && v >= 10 && v <= 10000) {
                maxFrontendLogs = v;
                wsSend({ type: 'max_frontend_logs', data: maxFrontendLogs });
                addFrontendLog('日志上限变更为 ' + v + ' 条');
            }
        }
```

在 `applySettingsMaxFrontendLogs` 之后加：

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

---

## Task 12: 重启服务 + 手动验证

**验证流程**（无测试框架，全手动）：

- [ ] **Step 12.1: 启动/重启服务**

如果服务未运行：
```bash
npm start
```

如果服务已运行且只是改了前端代码（不需要重启）：
- 直接刷新浏览器即可（前端是静态文件）

如果改了后端 `server.js`：
```bash
npm run restart
```

- [ ] **Step 12.2: 首次连接测试**

打开浏览器 `http://localhost:65433`，创建 1 个终端，确认：
- 终端正常显示 PowerShell 提示符
- 打开设置弹窗，「buffer 去重比对长度」显示 4096
- 前端日志显示「缓冲区全量回放 N 字节 (Shell #1)」（因为是首次连接，createTermInstance 走 tail: '' → 档 3）

- [ ] **Step 12.3: 核心收益场景 - 静置重连**

1. 客户端创建 5 个终端，每个运行 `while($true){Get-Date;Start-Sleep 1}`（持续输出）
2. 等 30 秒让 buffer 累积
3. Chrome DevTools → Network 面板 → Offline
4. 取消 Offline，触发重连
5. 预期：
   - 5 个 `data: ''` 几乎同时到达（response payload 几十字节）
   - 5 个 loading 圈几乎同时消失
   - 前端日志显示「缓冲区无变化，跳过回放」× 5
   - xterm 内容保持不变
   - Network 面板显示下行 payload 远小于旧版的 50MB+

- [ ] **Step 12.4: 断网期间有 PTY 输出（验证档 2 增量推送）**

1. 创建一个终端，运行 `while($true){Get-Date;Start-Sleep 1}`
2. Chrome DevTools → Network → Offline
3. 等待 30 秒（断网期间服务端 buffer 累积 ~900 字节）
4. 取消 Offline
5. 预期：
   - 前端日志显示「缓冲区增量 N 字节 (Shell #1)」（N 约 900）
   - xterm 显示断网期间所有输出，无重复、无丢失
   - xterm 不重置（reset 不会触发），新内容追加在末尾

- [ ] **Step 12.5: 等待期间 data 消息被丢弃（验证 pendingBuffer）**

1. 创建一个终端，运行 `1..1000 | ForEach-Object { Write-Output $_; Start-Sleep 0.01 }`（快速输出）
2. Chrome DevTools → Network → Offline
3. 立即取消 Offline（断网窗口极短）
4. 预期：
   - 终端内容**无重复、无丢失**
   - 不会出现「1\n1\n2\n2」这种重复
   - 不会丢数字（1..1000 全部出现）

- [ ] **Step 12.6: 调小/调大 clientTailMax**

1. 打开设置弹窗，把「buffer 去重比对长度」改成 1024，应用
2. 预期：前端日志「buffer 去重比对长度变更为 1024 字节」
3. 类似改成 16384
4. 重连验证 tail 长度变化（通过前端日志中的"缓冲区全量/增量/无变化"行为变化）

- [ ] **Step 12.7: 检查 config.json 持久化**

查看 `config.json`，应有 `clientTailMax: 4096` 字段（首次启动后由 server.js 写入；老用户可能没这个字段，靠前端默认值 4096 兜底）。

---

## 任务依赖关系

```
Task 1 (config) ──┐
                  ├─→ Task 12 (验证)
Task 2 (服务端 buffer) ──┤
                       │
Task 3 (client_tail_max)─┤
                       │
Task 4 (前端变量) ──┐
                   ├─→ Task 5 (工具函数) ──┐
                                          ├─→ Task 6 (data 处理器)
                                          ├─→ Task 7 (buffer 处理器)
Task 8 (list 处理器) ───────────────────┤
Task 9 (createTermInstance) ────────────┤
Task 10 (client_tail_max 处理器) ────────┤
Task 11 (设置弹窗) ─────────────────────┘
```

**建议实施顺序**：Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12

**后端必须先做（Task 1-3）**：
- 老前端对老服务端兼容
- 老前端对老服务端不传 tail，服务端走档 3 全量分支（与旧行为等价）
- 但本次前端也要改，所以**两批可以一起做**

---

## 风险与回滚

**回滚方法**：所有改动是独立的，可以按 Task 顺序反向回滚：
- 移除 Task 11 的弹窗 HTML 行
- 移除 Task 11 的 applySettingsClientTailMax 函数
- 移除 Task 10 的 else if 分支
- 还原 Task 9 的 createTermInstance 末尾
- 还原 Task 8 的两处
- 还原 Task 7 的 buffer 处理器
- 还原 Task 6 的 data 处理器
- 移除 Task 5 的两个函数
- 移除 Task 4 的三个声明
- 还原 Task 3 的两处
- 还原 Task 2 的 buffer 处理器
- 还原 Task 1 的 def 和 loadConfig

**已知风险**（来自 spec）：

1. **`lastIndexOf` 误匹配病理**（如 `abcabcab`）：pos 偏后，delta 偏短；客户端只 write 不 reset，xterm 内容 = 旧内容 + 部分新增；`endsWith` 不命中所以走不到档 1。**已知极限，不处理**。

2. **服务端 buffer 超过 maxBufferChars * 2 滞回截断**：截断后客户端 xterm 累积内容可能比服务端 buf 长，档 3 全量发；客户端 reset + write 后 xterm 内容 = 截断后的服务端 buf。**符合预期**。

3. **服务端空 buf**（PTY 进程死了）：档 3 全量发空字符串，客户端 reset + write('') → xterm 空。**符合预期**。
