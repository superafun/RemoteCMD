# 重连同步改造（headless 可见屏幕）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重连/切会话时，服务端用 headless xterm 维护"当前可见屏幕 + 有界真实滚屏历史"，只把这份屏幕（而非原始字节流）序列化发回客户端，从而修掉 TUI 动画场景下可见屏幕静止部分丢失的 bug；先用整屏全量直发验证核心机制，再做逐行 diff 增量。

**Architecture:** 服务端每个会话新增一个 `@xterm/headless` 终端实例（scrollback 有界、尺寸跟随 `current_size` 槽位），与客户端同吃一份 PTY 字节流，把流折叠成屏幕状态。重连时客户端发可见视口指纹，服务端比对后用 `@xterm/addon-serialize` 序列化整个 buffer 发回，客户端 `reset()`+`write()` 重建。Phase 1 全量直发（保留 legacy 字节流作 `syncMode` 兜底）；Phase 2 逐行 diff 增量。

**Tech Stack:** Node.js + `node-pty`（已有）、`@xterm/headless`（新增）、`@xterm/addon-serialize`（新增）、`@xterm/xterm` v6.0.0（已有，headless 同版本）、`@xterm/addon-unicode11` v0.9.0（已有，headless 同加载以保证字符宽度对齐）、浏览器端 xterm.js（已有）。

## Global Constraints

- 所有会话共享单一 `current_size` 尺寸（`resizeAllPtys` 一次性 resize 全部 PTY），headless 终端尺寸必须同步该槽位，与所有客户端对齐。
- headless 终端 `scrollback` 必须是有界行数（默认约 1000），**绝不能用 `scrollback:0`**（否则重连后无法上滚看历史）。
- 旧"字节 tail 块匹配"增量**不复用**；Phase 2 增量只能是逐行 diff。
- 序列化产物大小受 `maxSyncBytes` 硬上限约束，超限降级走 legacy 全量兜底（仅 Phase 1 有效）。
- Phase 1 保留 `syncMode: 'screen' | 'legacy'` 配置开关（默认 `'screen'`）作兜底；验证稳定后删除 `legacy` 分支、`syncMode` 配置项与旧 `sessions[id].buffer` / `maxBufferChars` / `clientTailMax` 逻辑。
- 依赖版本须与已装 `@xterm/xterm` v6.0.0 兼容（`@xterm/headless` 与 `@xterm/addon-serialize` 安装时锁定 `^6.0.0`）。
- 每次改动后单独 commit，消息带 `feat:`/`refactor:` 前缀。

---

## 文件结构

- `server.js`（修改）：新增 headless 终端创建/喂流/resize；改 `buffer` 消息处理为指纹比对 + 序列化全量；新增 `syncMode` 配置与 legacy 兜底分支；清理 `client_tail_max` 广播（Phase 1 保留开关，Phase 2 删除）。
- `public/term-session.js`（修改）：`requestBuffer()` 改发可见视口指纹 `screenHash`（legacy 模式仍发 `tail`）；`handleBufferResponse()` 处理 `reset:+ansi` 整屏重建；保留 `appendClientTail` 供 legacy。
- `package.json`（修改）：新增 `@xterm/headless`、`@xterm/addon-serialize` 依赖。
- `config.json`（运行时生成，不在仓库强约束）：新增 `syncMode`，后续新增 `screenHistoryLines` 替代 `maxBuffer`。

---

### Task 1: 安装 headless 与 serialize 依赖

**Files:**
- Modify: `package.json:16-20`
- Run: `npm install`

**Interfaces:**
- 本任务产出：仓库中可 `require('@xterm/headless')` 与 `require('@xterm/addon-serialize')`，版本与 `@xterm/xterm` v6.0.0 一致。

- [ ] **Step 1: 在 package.json 的 dependencies 增加两项**

```json
  "dependencies": {
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-unicode11": "^0.9.0",
    "@xterm/addon-web-links": "^0.12.0",
    "@xterm/headless": "^6.0.0",
    "@xterm/addon-serialize": "^0.13.0",
    "@xterm/xterm": "^6.0.0",
```

- [ ] **Step 2: 安装并确认版本**

Run: `npm install`
Expected: 无报错退出码 0；随后 `node -e "console.log(require('@xterm/headless/package.json').version, require('@xterm/addon-serialize/package.json').version)"` 输出版本（headless 应为 6.x，serialize 应为 0.13.x 或兼容 6.x 的版本）。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: 新增 @xterm/headless 与 @xterm/addon-serialize 依赖（重连同步改造）"
```

---

### Task 2: 服务端添加 headless 终端（创建 + 喂流 + resize）

**Files:**
- Modify: `server.js:1-6`（顶部 require）
- Modify: `server.js:187-203`（`createSession` 创建 headless 终端）
- Modify: `server.js:205-210`（`onData` 中喂 headless 终端）
- Modify: `server.js:104-106`（`resizeAllPtys` 同步 resize headless）

**Interfaces:**
- Consumes: `config.sizeSlots`、`config.currentSize`、`sessions` 对象。
- Produces:
  - `sessions[id].screen`：headless `Terminal` 实例（带 `Unicode11Addon`、`SerializeAddon`），`scrollback` 由 `config.screenHistoryLines` 决定（本任务先用常量占位 `1000`，Task 7 接入配置）。
  - `sessions[id].screen.write(d)`：喂 PTY 字节流。
  - `sessions[id].screen.resize(cols, rows)`：尺寸同步。
  - 全局 `syncMode`（Task 5 引入）；本任务无条件创建 headless（legacy 模式下也创建，仅不使用其同步结果）。

- [ ] **Step 1: 顶部引入 headless 与 serialize**

在 `server.js:6` 之后追加：

```javascript
const pty = require('node-pty');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { Unicode11Addon: HeadlessUnicode11Addon } = require('@xterm/addon-unicode11');
```

- [ ] **Step 2: 在 createSession 中创建 headless 终端**

替换 `server.js:203` 的 `sessions[newId] = {...}` 行，并在其后创建 headless 终端：

```javascript
    sessions[newId] = { pty: ptyProcess, buffer: '', inputLine: '', name: computeSmartName(), bellTimer: null, bellArmed: false };
    // === 重连同步：headless 终端维护当前屏幕（可见视口 + 有界真实滚屏历史）===
    // scrollback 用有界行数（占位 1000，Task 7 接入 config.screenHistoryLines），绝不为 0。
    // 加载 Unicode11Addon 与客户端一致，保证字符宽度/换行对齐；SerializeAddon 用于重连时序列化整屏。
    const screen = new HeadlessTerminal({ scrollback: 1000, allowProposedApi: true });
    screen.loadAddon(new HeadlessUnicode11Addon());
    screen.unicode.activeVersion = '11';
    const serializeAddon = new SerializeAddon();
    screen.loadAddon(serializeAddon);
    screen.resize(slot.cols, slot.rows);
    sessions[newId].screen = screen;
    sessions[newId].serializeAddon = serializeAddon;
```

- [ ] **Step 3: 在 onData 中喂 headless 终端**

在 `server.js:206`（`sessions[newId].buffer += d;`）之后追加一行：

```javascript
        sessions[newId].buffer += d;
        // 同步喂给 headless 终端，折叠成当前屏幕状态（重连同步用）
        try { sessions[newId].screen.write(d); } catch (e) { /* headless 写失败不影响实时流 */ }
```

- [ ] **Step 4: 在 resizeAllPtys 中同步 resize headless**

替换 `server.js:104-106`：

```javascript
// 调整所有 PTY 尺寸（含 headless 屏幕，保证与所有客户端同尺寸对齐）
function resizeAllPtys(rows, cols) {
    Object.values(sessions).forEach(s => {
        s.pty.resize(cols, rows);
        if (s.screen) { try { s.screen.resize(cols, rows); } catch (e) {} }
    });
}
```

- [ ] **Step 5: 冒烟验证 headless 创建不报错**

Run: `node -e "const {Terminal}=require('@xterm/headless'); const t=new Terminal({scrollback:1000,allowProposedApi:true}); t.loadAddon(require('@xterm/addon-unicode11').Unicode11Addon); t.loadAddon(require('@xterm/addon-serialize').SerializeAddon); t.resize(80,24); t.write('hello\x1b[2J\x1b[Hworld'); console.log('headless ok, lines=', t.buffer.active.length);"`
Expected: 输出 `headless ok, lines= 24`（或接近），无异常抛出。

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: 服务端为每个会话创建 headless 终端并随 PTY 喂流/resize"
```

---

### Task 3: 客户端 requestBuffer 发可见视口指纹（screen 模式）

**Files:**
- Modify: `public/term-session.js:71-78`（`requestBuffer`）
- Modify: `public/term-session.js:103-115`（`appendClientTail`/`trimClientTail` 保留给 legacy）

**Interfaces:**
- Consumes: 全局 `clientTailMax`、`syncMode`（Task 5 引入；本任务先用变量占位，从 `window.syncMode` 读取，缺省 `'screen'`）、`this.term`（xterm 实例）。
- Produces:
  - `requestBuffer()` 在 screen 模式下发送 `{ type:'buffer', id, screenHash }`；legacy 模式发送 `{ type:'buffer', id, tail }`（保持旧行为）。
  - 模块内辅助函数 `computeViewportHash(term)`：返回可见视口（0..rows-1 行）文本的哈希字符串。

- [ ] **Step 1: 新增可见视口指纹辅助函数**

在 `public/term-session.js` 的 `class TermSession` 之外（文件顶部或类前）新增：

```javascript
// 计算 xterm 可见视口的指纹：拼接 0..rows-1 行文本后做轻量哈希。
// 仅用于重连"未变更则跳过"的优化，不相等时服务端会整屏重发，故哈希碰撞可接受（碰撞仅多一次全量）。
function computeViewportHash(term) {
    const buf = term.buffer.active;
    const rowCount = term.rows;
    let s = '';
    for (let i = 0; i < rowCount; i++) {
        const line = buf.getLine(i);
        s += line ? line.translateToString() : '';
        s += '\n';
    }
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}
```

- [ ] **Step 2: 改写 requestBuffer 支持 screen / legacy 两种模式**

替换 `public/term-session.js:71-78`：

```javascript
    // === Buffer 协议 ===
    // screen 模式（默认）：发可见视口指纹 screenHash，服务端比对后决定发 0 字节或整屏。
    // legacy 模式：发尾部字节 tail（旧字节流机制，仅作兜底）。
    requestBuffer() {
        if (window.syncMode === 'legacy') {
            if (this.clientTail.length > clientTailMax) {
                this.clientTail = this.clientTail.slice(-clientTailMax);
            }
            this.pendingBuffer = true;
            wsSend({ type: 'buffer', id: this.id, tail: this.clientTail });
            this.showBufferLoading();
            return;
        }
        const hash = computeViewportHash(this.term);
        this.pendingBuffer = true;
        wsSend({ type: 'buffer', id: this.id, screenHash: hash });
        this.showBufferLoading();
    }
```

- [ ] **Step 3: 确认 appendClientTail/trimClientTail 仍保留（legacy 用）**

`public/term-session.js:103-115` 保持不变（legacy 路径仍追加 `clientTail`）；screen 模式下 `write()` 不再调用 `appendClientTail`（见 Task 4 的 `write` 调整）。

- [ ] **Step 4: Commit**

```bash
git add public/term-session.js
git commit -m "feat: 客户端 requestBuffer 支持 screen 模式（发可见视口指纹）"
```

---

### Task 4: 客户端 handleBufferResponse 整屏重建（screen 模式）

**Files:**
- Modify: `public/term-session.js:62-87`（`write` 与 `handleBufferResponse`）

**Interfaces:**
- Consumes: 服务端 `buffer` 响应消息 `{ data, reset }`；`this.term`。
- Produces:
  - `handleBufferResponse(msg)`：screen 模式收到 `reset:true` 时 `term.reset(); term.write(data)` 重建整屏（视口 + 可上滚历史）；`data===''` 时跳过。
  - `write(data, mode)`：screen 模式下不再维护 `clientTail`（仅 legacy 维护）。

- [ ] **Step 1: 改写 write 与 handleBufferResponse**

替换 `public/term-session.js:62-87`：

```javascript
    // === 写入 ===
    // mode 缺省 'append'，'reset' 时先 reset 再 write。
    // screen 模式：不维护 clientTail（由服务端 headless 屏幕负责同步）。
    // legacy 模式：仍追加 clientTail 供断连时发 tail（见 Task 3 legacy 分支与 Task 5）。
    write(data, mode = 'append') {
        if (mode === 'reset') this.term.reset();
        this.term.write(data);
        if (window.syncMode === 'legacy') this.appendClientTail(data);
    }

    handleBufferResponse(msg) {
        this.pendingBuffer = false;
        this.hideBufferLoading();
        if (msg.data === '') return 'skip';
        if (msg.reset) { this.write(msg.data, 'reset'); return 'full'; }
        this.write(msg.data); return 'incremental';
    }
```

- [ ] **Step 2: 在真实浏览器中验证整屏重建无报错**

用 Playwright/浏览器打开页面，创建一个会滚动输出的会话（如 `1..100 | Out-String` 或 `ping -t`），触发一次重连（刷新页面或切换会话），确认：
  - 重连后屏幕显示完整当前内容（而非残缺/乱码）；
  - 可向上滚动看到历史。
Expected: 无 JS 报错，屏幕完整且可上滚。

- [ ] **Step 3: Commit**

```bash
git add public/term-session.js
git commit -m "feat: 客户端 handleBufferResponse 支持整屏 reset+write 重建"
```

---

### Task 5: 服务端 buffer 消息处理（指纹比对 + 序列化全量 + legacy 兜底）

**Files:**
- Modify: `server.js:290-316`（`buffer` 消息分支）
- Modify: `server.js:9-33`（`loadConfig` 默认值新增 `syncMode`，及 `screenHistoryLines` 占位）
- Modify: `server.js:239-249`（`wss` 连接时广播 `syncMode`，保留 `client_tail_max` 供 legacy）
- Modify: `server.js:412-417`（legacy `max_buffer` 处理保留；Task 7 接入 `screenHistoryLines`）

**Interfaces:**
- Consumes: `sessions[id].screen`、`sessions[id].serializeAddon`、`config.syncMode`、`config.maxBufferChars`（legacy）、`computeViewportHash` 同口径服务端实现 `serverViewportHash(screen)`。
- Produces:
  - screen 模式：`{ type:'buffer', id, data:'' }`（未变更）或 `{ type:'buffer', id, data:<ansi>, reset:true }`（变更）。
  - legacy 模式：保持原 `endsWith`/`lastIndexOf`/全量三档逻辑不变。
  - `serverViewportHash(screen)`：服务端计算 headless 视口指纹，与客户端 `computeViewportHash` 同口径。

- [ ] **Step 1: 服务端视口指纹辅助函数**

在 `server.js` 顶部 `resizeAllPtys` 之前新增：

```javascript
// 计算 headless 终端可见视口的指纹，口径与前端 computeViewportHash 一致（FNV-1a）。
function serverViewportHash(screen) {
    const buf = screen.buffer.active;
    const rowCount = screen.rows;
    let s = '';
    for (let i = 0; i < rowCount; i++) {
        const line = buf.getLine(i);
        s += line ? line.translateToString() : '';
        s += '\n';
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}
```

- [ ] **Step 2: 配置默认值新增 syncMode**

在 `server.js:19` 附近（`clientTailMax: 4096,` 之后）新增：

```javascript
            syncMode: 'screen', // 'screen' = headless 整屏同步；'legacy' = 旧字节流兜底
```

（注：`screenHistoryLines` 在 Task 7 接入，本任务先不新增以免触发未使用配置告警。）

- [ ] **Step 3: 改写 buffer 消息分支**

替换 `server.js:290-316`：

```javascript
        else if (type === 'buffer' && sessions[id]) {
            const sess = sessions[id];
            // legacy 模式：旧字节流 tail 匹配（兜底用，Phase 1 保留）
            if (config.syncMode === 'legacy') {
                const buf = sess.buffer;
                const tail = p.tail;
                let data;
                let reset = true;
                if (tail !== '') {
                    if (buf.endsWith(tail)) {
                        data = '';
                        reset = false;
                    } else {
                        const i = buf.lastIndexOf(tail);
                        if (i !== -1) {
                            data = buf.slice(i + tail.length);
                            reset = false;
                        }
                    }
                }
                if (data === undefined) {
                    data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
                }
                ws.send(JSON.stringify({ type: 'buffer', id, data, ...(reset ? { reset: true } : {}) }));
                return;
            }
            // screen 模式（默认）：指纹比对 + 整屏序列化
            const screen = sess.screen;
            if (!screen) { return; } // 无 headless 终端则不发屏（靠实时流恢复）
            try {
                const serverHash = serverViewportHash(screen);
                if (p.screenHash && p.screenHash === serverHash) {
                    // 未变更：发 0 字节，客户端保持原样
                    ws.send(JSON.stringify({ type: 'buffer', id, data: '' }));
                    return;
                }
                // 变更：序列化整个 buffer（可见视口 + 有界真实滚屏历史）发回
                const ansi = sess.serializeAddon.serialize();
                if (ansi.length > maxSyncBytes) {
                    // 超上限降级：legacy 全量字节流兜底
                    const buf = sess.buffer;
                    const fallback = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
                    ws.send(JSON.stringify({ type: 'buffer', id, data: fallback, reset: true }));
                    return;
                }
                ws.send(JSON.stringify({ type: 'buffer', id, data: ansi, reset: true }));
            } catch (e) {
                // 序列化失败：不发屏，靠实时流恢复，绝不崩
                console.error('[buffer] serialize failed, skip:', e && e.message);
            }
        }
```

- [ ] **Step 4: 定义 maxSyncBytes 常量**

在 `server.js:82` 附近（`let maxBufferChars = ...` 之后）新增：

```javascript
// 重连同步序列化产物硬上限（约 4MB），超限降级 legacy 全量兜底
const maxSyncBytes = 4 * 1000 * 1000;
```

- [ ] **Step 5: 连接时广播 syncMode，保留 client_tail_max 给 legacy**

`server.js:249` 保持 `client_tail_max` 广播不变；在其后追加：

```javascript
    ws.send(JSON.stringify({ type: 'sync_mode', data: config.syncMode }));
```

并在前端 `wss.onmessage` 处理中（负责接收设置消息处）增加：`if (type === 'sync_mode') window.syncMode = data;`（前端接收点见 Task 6）。

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: 服务端 buffer 消息改为指纹比对+整屏序列化(screen)，保留 legacy 兜底"
```

---

### Task 6: 前端接入 syncMode 全局变量

**Files:**
- Modify: `public/index.html:177`（与 `clientTailMax` 全局同处，新增 `syncMode` 初值）
- Modify: `public/index.html:952`（在 `client_tail_max` 消息处理分支旁新增 `sync_mode` 处理）

**Interfaces:**
- Consumes: 服务端 `sync_mode` 消息（Task 5 Step 5 广播）。
- Produces: `window.syncMode` 被赋值为 `'screen'` 或 `'legacy'`（`public/term-session.js` 的 `requestBuffer` 已读取，见 Task 3/4）。

- [ ] **Step 1: 新增 syncMode 初值**

在 `public/index.html:177`（`let clientTailMax = 4096;` 附近）新增：

```javascript
        let clientTailMax = 4096;  // 默认值，config.json 加载后会覆盖
        let syncMode = 'screen';  // 'screen' = headless 整屏同步；'legacy' = 旧字节流兜底
```

- [ ] **Step 2: 增加 sync_mode 消息处理**

在 `public/index.html:952`（`client_tail_max` 处理分支 `clientTailMax = msg.data;` 旁）新增：

```javascript
                clientTailMax = msg.data;
                clientTailMax2 = msg.data * 2;
                sessions.forEach(s => s.trimClientTail(clientTailMax));
                addFrontendLog('buffer 去重比对长度同步为 ' + clientTailMax + ' 字节', 'in');
            } else if (type === 'sync_mode') {
                syncMode = msg.data; // 'screen' | 'legacy'
```

（说明：`syncMode` 为 `index.html` 顶层 `let`，浏览器中即 `window.syncMode`，`term-session.js` 可直接读取。）

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 前端接入 syncMode 全局开关(screen/legacy)"
```

---

### Task 7: 接入 screenHistoryLines 配置替代 maxBuffer（Phase 1 末）

**Files:**
- Modify: `server.js:9-33`（`loadConfig` 默认值 `screenHistoryLines`）
- Modify: `server.js:82`（`maxBufferChars` 行保留给 legacy；新增 `screenHistoryLines` 应用）
- Modify: `server.js:412-417`（`max_buffer` 处理改为同时更新 `screenHistoryLines`，保留 legacy `maxBufferChars` 更新）
- Modify: `server.js:203` 附近（Task 2 创建的 headless `scrollback: 1000` 改为 `config.screenHistoryLines`）
- Modify: `server.js:269` 连接广播（`max_buffer` 保留；新增 `screen_history_lines` 广播）
- Modify: 前端设置 UI（搜索 `max_buffer` 设置入口）增加 `screen_history_lines` 或复用同一控件

**Interfaces:**
- Consumes: `config.screenHistoryLines`（有界滚屏行数，默认 1000）。
- Produces: headless 终端 `scrollback` 由配置驱动；`screen_history_lines` 可经设置 UI 调整并落盘。

- [ ] **Step 1: 配置默认值新增 screenHistoryLines**

在 `server.js` 默认对象中新增：

```javascript
            screenHistoryLines: 1000, // headless 终端保留的真实滚屏历史行数（重连可上滚查看）
```

- [ ] **Step 2: headless 创建使用配置值**

将 Task 2 Step 2 中的 `new HeadlessTerminal({ scrollback: 1000, ... })` 改为：

```javascript
    const screen = new HeadlessTerminal({ scrollback: config.screenHistoryLines || 1000, allowProposedApi: true });
```

- [ ] **Step 3: max_buffer 设置消息同时更新 screenHistoryLines**

在 `server.js:412-417` 的 `max_buffer` 分支中，在 `maxBufferChars = data * 1000000;` 之后追加：

```javascript
            // maxBuffer 仍驱动 legacy 字节流上限；screenHistoryLines 由独立设置控制（此处保持 legacy 兼容）
```

（说明：`screenHistoryLines` 经独立的 `screen_history_lines` 消息更新，见 Step 5；`max_buffer` 仅 legacy 用，二者语义分离。）

- [ ] **Step 4: 新增 screen_history_lines 设置消息处理**

在 `server.js` 设置消息分支区新增：

```javascript
        else if (type === 'screen_history_lines') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 0 || v > 20000) return;
            config.screenHistoryLines = v;
            // 应用到新创建的会话；已在运行的会话在下次重连/重建时按新值创建 headless 终端
            // （headless 终端 scrollback 在构造时确定，不在运行时热改，避免内部 API 脆弱性）
            broadcast({ type: 'screen_history_lines', data: config.screenHistoryLines });
            saveConfig(config);
        }
```

- [ ] **Step 5: 连接时广播 screen_history_lines，前端接入**

`server.js:269` 附近追加广播：

```javascript
    ws.send(JSON.stringify({ type: 'screen_history_lines', data: config.screenHistoryLines }));
```

前端设置 UI 增加 `screen_history_lines` 输入（值范围 0–20000，0 表示仅视口无历史——但本设计坚持有界历史，UI 文案注明"建议 ≥ 200"），发送 `screen_history_lines` 消息；前端 `onmessage` 增加对应处理（同 Task 6 模式）。

- [ ] **Step 6: Commit**

```bash
git add server.js public/
git commit -m "feat: 接入 screenHistoryLines 配置(headless scrollback 由配置驱动)"
```

---

### Task 8: Phase 1 真机验证（安卓 + TUI）

**Files:** 无代码改动，纯验证。

**Interfaces:**
- Consumes: Task 1–7 全部产出；`syncMode` 默认 `'screen'`。

- [ ] **Step 1: 启动服务并用桌面浏览器验证 TUI 完整屏**

Run: 启动 `server.js`（或 `npm start`），浏览器打开，运行 `top`（或任意频繁刷新单角的 TUI）。触发重连（刷新页面）。
Expected: 重连后显示**完整整屏**（含静止部分），非只有刷新角；可上滚看历史。

- [ ] **Step 2: 用用户的 10 字符例子验证无动画垃圾**

构造：界面只显示约 10 字符、末字符被反复删建大量次数的场景（如一段循环改写末字符的 PowerShell 脚本）。重连。
Expected: 重连只同步最终约 10 字符；服务端内存不含那大量重复操作字节串（对比旧机制会膨胀 `sessions[id].buffer`）。

- [ ] **Step 3: 安卓真机验证**

用安卓真机（HTTPS 访问，见项目约定）重复 Step 1–2。
Expected: 同桌面，整屏正确、可上滚、重连顺畅。

- [ ] **Step 4: 未变更场景验证**

重连时屏幕未变（停在静态提示符），观察 WS 流量。
Expected: 服务端对该客户端发 `data:''`（0 字节载荷），客户端跳过——即指纹命中。

- [ ] **Step 5: 尺寸切换后重连验证**

切换 `current_size`（large↔small）后重连。
Expected: 屏幕分辨率正确，headless 与客户端同尺寸对齐。

- [ ] **Step 6: 如验证不顺，一键回退**

若真机出现屏幕错位/乱码，将 `config.json` 中 `syncMode` 改为 `'legacy'`（或临时 `window.syncMode='legacy'`）即时回退到旧字节流机制，记录问题供后续排查；稳定后再删 legacy。

---

### Task 9: 清理 legacy 兜底（Phase 1 验证稳定后）

**Files:**
- Modify: `server.js`（`syncMode` 分支、`client_tail_max` 广播、`max_buffer` 处理中 legacy 路径、`sessions[id].buffer` 维护）
- Modify: `public/term-session.js`（`requestBuffer`/`write` 的 legacy 分支、`appendClientTail`/`trimClientTail`）
- Modify: 前端设置 UI（`max_buffer` / `client_tail_max` 控件，如存在）
- Modify: `config.json` 运行时（移除 `syncMode`、`clientTailMax`、`maxBuffer` 旧字段，新增 `screenHistoryLines` 为历史量语义）

**Interfaces:**
- Consumes: Task 8 验证结论（稳定）。
- Produces: 仅保留 headless screen 同步路径；删除 legacy 字节流逻辑、`syncMode`/`clientTailMax`/`maxBuffer` 配置与广播、客户端 `clientTail` 维护。

- [ ] **Step 1: 删除服务端 legacy 路径**

在 `server.js` 的 `buffer` 分支移除 `if (config.syncMode === 'legacy') { ... }` 整段，仅保留 screen 模式逻辑；移除 `sessions[newId].buffer = ''` 初始化与 `onData` 中的 `buffer += d`、滞回截断；移除 `maxBufferChars` 相关（含 `max_buffer` 消息处理与连接广播 `max_buffer`/`client_tail_max`）；移除 `syncMode` 配置项与广播。

- [ ] **Step 2: 删除客户端 legacy 路径**

在 `public/term-session.js` 的 `requestBuffer` 移除 legacy 分支（只发 `screenHash`）；`write` 移除 `if (window.syncMode === 'legacy') this.appendClientTail(data)`；删除 `appendClientTail`/`trimClientTail` 方法及 `this.clientTail` 字段；移除前端 `client_tail_max`/`sync_mode` 消息处理与 `window.syncMode`。

- [ ] **Step 3: 配置清理**

`loadConfig` 默认值移除 `clientTailMax`、`maxBuffer`、`syncMode`；保留/新增 `screenHistoryLines`。`config.json` 中旧字段在下次保存时被自然剔除（或手动编辑移除）。

- [ ] **Step 4: 回归验证**

重复 Task 8 的 Step 1–3（桌面 + 安卓），确认清理后行为不变（整屏正确、可上滚、无动画垃圾）。

- [ ] **Step 5: Commit**

```bash
git add server.js public/ config.json
git commit -m "refactor: 删除 legacy 字节流兜底，仅保留 headless 屏幕同步"
```

---

### Task 10: Phase 2 —— 逐行 diff 增量

**Files:**
- Modify: `public/term-session.js`（`requestBuffer` 在 screen 模式下改发整屏行数组；`handleBufferResponse` 处理 `{rows:[{row,text}]}` 补丁）
- Modify: `server.js`（`buffer` 分支 screen 模式：收到整屏行数组后逐行 diff，只回变更行或降级整屏）

**Interfaces:**
- Consumes: Task 9 清理后的 screen 模式；`sessions[id].screen` 行内容；客户端上传的整屏行数组。
- Produces:
  - 客户端 `requestBuffer` 发 `{ type:'buffer', id, screen: { rows:[...], cols, rowCount } }`（整屏，供 diff）。
  - 服务端回 `{ type:'buffer', id, rows:[{row, text}], reset:false }`（仅变更行）或 `{ ..., reset:true, data:<ansi> }`（变更过多降级整屏）。
  - 客户端按 `row` 用 ANSI 光标定位写入：`\x1b[<row+1>;1H` + `text`（清行 `\x1b[2K` 视情况）。

- [ ] **Step 1: 客户端上传整屏行数组**

改写 `public/term-session.js` 的 screen 模式 `requestBuffer`：

```javascript
        // screen 模式：上传整屏（视口 + 可上滚历史）每行文本，供服务端逐行 diff
        const buf = this.term.buffer.active;
        const rows = [];
        for (let i = 0; i < buf.length; i++) {
            const line = buf.getLine(i);
            rows.push(line ? line.translateToString() : '');
        }
        this.pendingBuffer = true;
        wsSend({ type: 'buffer', id: this.id, screen: { rows, cols: this.term.cols, rowCount: this.term.rows } });
        this.showBufferLoading();
```

- [ ] **Step 2: 服务端逐行 diff**

在 `server.js` 的 `buffer` 分支 screen 模式（Task 5 Step 3）中，当收到 `p.screen` 时：

```javascript
                const clientRows = p.screen && p.screen.rows;
                if (Array.isArray(clientRows) && clientRows.length) {
                    const sb = screen.buffer.active;
                    const serverRows = [];
                    for (let i = 0; i < sb.length; i++) {
                        const line = sb.getLine(i);
                        serverRows.push(line ? line.translateToString() : '');
                    }
                    const changed = [];
                    const n = Math.max(clientRows.length, serverRows.length);
                    for (let i = 0; i < n; i++) {
                        if (clientRows[i] !== serverRows[i]) changed.push({ row: i, text: serverRows[i] || '' });
                    }
                    // 变更行数超过阈值（如 60%）则降级整屏全量
                    if (changed.length > 0 && changed.length <= Math.ceil(serverRows.length * 0.6)) {
                        ws.send(JSON.stringify({ type: 'buffer', id, rows: changed, reset: false }));
                        return;
                    }
                    // 否则整屏
                    const ansi = sess.serializeAddon.serialize();
                    ws.send(JSON.stringify({ type: 'buffer', id, data: ansi, reset: true }));
                    return;
                }
```

（注：无 `p.screen` 时退化为 Task 5 的指纹比对逻辑——兼容 Phase 2 过渡与未上传整屏的客户端。）

- [ ] **Step 3: 客户端应用行补丁**

在 `public/term-session.js` 的 `handleBufferResponse` 增加行补丁分支：

```javascript
        if (Array.isArray(msg.rows)) {
            for (const r of msg.rows) {
                this.term.write('\x1b[' + (r.row + 1) + ';1H\x1b[2K' + (r.text || ''));
            }
            return 'patch';
        }
```

- [ ] **Step 4: 验证 diff 生效**

桌面 + 安卓：运行一个只动角落的 TUI（如带时钟的 top），重连，用浏览器 DevTools Network 观察 `buffer` 响应——应只含变更行（小 payload），而非整屏 ANSI。
Expected: 重连流量显著小于整屏；屏幕重建正确。

- [ ] **Step 5: Commit**

```bash
git add server.js public/term-session.js
git commit -m "feat: Phase2 重连同步逐行 diff 增量（仅回变更行）"
```

---

## 自检说明（计划覆盖对照 spec）

- spec §1/§3（headless 终端、scrollback 有界、尺寸跟随 current_size）：Task 2、Task 7。
- spec §4（请求发指纹、服务端比对、整屏序列化、reset+write 重建）：Task 3、Task 4、Task 5。
- spec §5 Phase 1（全量直发 + legacy 兜底 syncMode）：Task 1–6、Task 8；清理：Task 9。
- spec §5 Phase 2（逐行 diff）：Task 10。
- spec §6（write 同步性、尺寸对齐、maxSyncBytes、异常兜底、内存）：Task 2 Step4 resize 同步、Task 5 Step3 try/catch + maxSyncBytes。
- spec §7（配置变更：移除 maxBuffer/clientTailMax，新增 screenHistoryLines）：Task 7、Task 9。
- spec §8（测试：TUI 完整屏、10 字符例子、可上滚、未变更 0 字节、尺寸切换、内存、安卓真机）：Task 8。
- spec §9（落地核对点）：贯穿 Task 2/5/7/9/10 的实现注意。

无占位符、无 TBD；类型/消息名（screenHash / screen / rows / reset / syncMode / screenHistoryLines）在各任务间一致。
