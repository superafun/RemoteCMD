# 会话重命名功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能为每个 PowerShell 会话自定义名称（如"构建服务器"），显示在现有下拉框中，名称随会话存活并多客户端同步。

**Architecture:** 服务端 `sessions[id]` 增加 `name` 字段；`list` 消息附带 `names` 映射（复用现有广播，不新增消息类型给服务端→客户端方向）；客户端新增 `rename` 消息给服务端。前端下拉框重建从 `innerHTML` 改为 DOM API + `textContent` 以防注入。`prompt()` 触发重命名。

**Tech Stack:** Node.js + Express 5 + ws 8 + node-pty（后端）；HTML + 原生 JS + xterm.js v6（前端，无 bundler）。

**关于验证：** 本项目无测试框架（`package.json` test 为占位 echo，AGENTS.md 明确 "No test framework"）。按用户决策采用**手动验证**替代自动化测试，偏离 TDD skill 默认。每个 task 后手动跑 `node server.js` + 浏览器验证。

**关于 git：** 项目非 git 仓库（AGENTS.md 明确）。无 commit 步骤，每个 task 末尾改为手动验证 + 标记完成。

**参考 spec：** [docs/superpowers/specs/2026-06-25-session-rename-design.md](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\docs\superpowers\specs\2026-06-25-session-rename-design.md)

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `server.js` | 修改 | session 对象加 `name`；`buildListMsg()` 辅助；所有 `list` 广播带 `names`；新增 `rename` 消息处理 |
| `public/index.html` | 修改 | 工具栏加「重命名」按钮；`names` 变量；`list` 处理器读 `names` 并用 DOM API 安全重建下拉框；`renameCurrent()` |

保持项目"单文件、无新抽象"约定：仅新增一个 `buildListMsg()` 小函数消除三处 `list` 构造重复。

---

### Task 1: 服务端 - session 加 name 字段 + buildListMsg + list 广播携带 names

**Files:**
- Modify: `server.js:38` (createSession 中的 sessions 赋值)
- Modify: `server.js:31-34` (broadcast 附近新增 buildListMsg)
- Modify: `server.js:58` (createSession 末尾 broadcast)
- Modify: `server.js:63-64` (onExit broadcast)
- Modify: `server.js:68` (wss connection 时 ws.send 的 list)

- [ ] **Step 1: 在 broadcast 函数下方新增 buildListMsg**

在 [server.js:32](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L32) 的 `function broadcast(...)` 之后插入：

```js
function buildListMsg() {
    const names = {};
    for (const id of Object.keys(sessions)) {
        names[id] = sessions[id].name;
    }
    return { type: 'list', ids: Object.keys(sessions), names };
}
```

- [ ] **Step 2: createSession 给 session 加 name 字段**

修改 [server.js:38](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L38)：

```js
    sessions[newId] = { pty: ptyProcess, buffer: '', name: null };
```

- [ ] **Step 3: createSession 末尾 broadcast 改用 buildListMsg**

修改 [server.js:58](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L58)：

```js
    broadcast(buildListMsg());
```

- [ ] **Step 4: onExit broadcast 改用 buildListMsg**

修改 [server.js:63](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L63) `ptyProcess.onExit` 内：

原：
```js
        broadcast({ type: 'list', ids: Object.keys(sessions) });
```
改为：
```js
        broadcast(buildListMsg());
```

- [ ] **Step 5: wss connection 时 ws.send 的 list 改为带 names**

修改 [server.js:68](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L68)：

原：
```js
    ws.send(JSON.stringify({ type: 'list', ids: Object.keys(sessions) }));
```
改为：
```js
    ws.send(JSON.stringify(buildListMsg()));
```

- [ ] **Step 6: 启动验证服务端不报错**

Run: `node server.js`
Expected: 控制台输出 `服务器已启动: http://localhost:<端口>`，无异常。打开浏览器 `http://localhost:<端口>`，下拉框仍显示 `Shell #1`（前端此时尚未读 names，会回退默认标签——这是预期的）。在浏览器 DevTools Network/WS 面板查看收到的 `list` 消息应含有 `names: {"1": null}` 字段。

- [ ] **Step 7: 手动验证后标记完成**

（项目无 git，无 commit 步骤。）

---

### Task 2: 服务端 - 新增 rename 消息处理

**Files:**
- Modify: `server.js:78` (ws.on('message') 的 type 分发，在 scroll_step 分支前/后插入)

- [ ] **Step 1: 新增 rename 分支**

在 [server.js:74-77](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L74-L77) 的 `resize` 分支之后、`hot_keys` 分支之前（或任意其他 `else if` 旁）插入：

```js
        else if (type === 'rename' && sessions[id]) {
            const name = (data == null ? '' : String(data)).trim().slice(0, 50);
            sessions[id].name = name === '' ? null : name;
            broadcast(buildListMsg());
        }
```

逻辑说明：
- `data == null` 兼容 null/undefined → 当空串处理
- `String(data).trim()` 去首尾空白
- `.slice(0, 50)` 截断
- 空串 → 置 `null`（前端回退 `Shell #id`）
- 非空 → 存字符串
- `sessions[id]` 不存在时整个分支短路，忽略（不报错、不广播）

- [ ] **Step 2: 启动并用 DevTools 验证**

Run: `node server.js`

浏览器开 `http://localhost:<端口>`，在 DevTools Console 执行（先确认 WebSocket 变量名 `ws`）：

```js
ws.send(JSON.stringify({ type: 'rename', id: 1, data: '构建服务器' }))
```

Expected: 收到新的 `list` 消息，其中 `names: {"1": "构建服务器"}`。前端下拉框此时尚未读 names，仍显示 `Shell #1`——这是预期的（前端在 Task 3 才读 names）。

再测试空串回退：

```js
ws.send(JSON.stringify({ type: 'rename', id: 1, data: '   ' }))
```

Expected: 收到 `list` 消息，`names: {"1": null}`。

再测试超长截断：

```js
ws.send(JSON.stringify({ type: 'rename', id: 1, data: 'A'.repeat(100) }))
```

Expected: `names: {"1": "AAAA...(50个A)"}`。

再测试不存在 id（不应崩溃、不应广播——Observable 差异：不收到新 list）：

```js
ws.send(JSON.stringify({ type: 'rename', id: 999, data: 'x' }))
```

Expected: 无新 `list` 消息，服务端无报错。

- [ ] **Step 3: 手动验证后标记完成**

---

### Task 3: 前端 - 维护 names 变量 + 安全重建下拉框

**Files:**
- Modify: `public/index.html:22` (新增 names 变量声明)
- Modify: `public/index.html:69-97` (list 消息处理器)

- [ ] **Step 1: 新增 names 模块级变量**

在 [public/index.html:22](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L22) `let editorDiv = null;` 下方新增：

```js
        let names = {};
```

- [ ] **Step 2: list 处理器开头更新 names**

在 [public/index.html:70](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L70) `const currentIds = msg.ids.map(String);` 上方插入：

```js
                        if (msg.names) names = msg.names;
```

- [ ] **Step 3: 用 DOM API 安全重建下拉框**

把 [public/index.html:91-96](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L91-L96) 的：

```js
                        const sel = document.getElementById('sessionSelect');
                        sel.innerHTML = msg.ids.map(id =>
                            `<option value="${id}" ${id == activeId ? 'selected' : ''}>Shell #${id}</option>`
                        ).join('');
```

替换为：

```js
                        const sel = document.getElementById('sessionSelect');
                        sel.innerHTML = '';
                        msg.ids.forEach(id => {
                            const opt = document.createElement('option');
                            opt.value = id;
                            opt.textContent = names[id] || ('Shell #' + id);
                            if (id == activeId) opt.selected = true;
                            sel.appendChild(opt);
                        });
```

说明：
- `textContent` 自动转义，防 `<script>` / `</option>` 注入
- `names[id] || (...)` 当 name 为 null/空串时回退默认（与 `||` 短路语义一致）
- `id == activeId` 保留弱等号（兼容字符串/数字比较，原有行为）

- [ ] **Step 4: 启动并验证多客户端同步**

Run: `node server.js`

开浏览器窗口 A 访问 `http://localhost:<端口>`，DevTools Console：

```js
ws.send(JSON.stringify({ type: 'rename', id: 1, data: '构建服务器' }))
```

Expected: 窗口 A 下拉框立即显示"构建服务器"（来自 Task 2 的 list 广播触发 Task 3 的新代码）。

开浏览器窗口 B 访问同地址（自动建立第二个 session，id=2）。
Expected: 窗口 B 下拉框显示"构建服务器"（来自连接时 ws.send 的 list，含 names）+ `Shell #2`。

- [ ] **Step 5: 验证 HTML 注入防护**

窗口 A Console：

```js
ws.send(JSON.stringify({ type: 'rename', id: 1, data: '<script>alert(1)</script>' }))
```

Expected: 下拉框显示字面文本 `<script>alert(1)</script>`，**不**弹 alert，下拉框**不**被破坏。

再测 `</option>` 注入：

```js
ws.send(JSON.stringify({ type: 'rename', id: 1, data: '</option><option>x' }))
```

Expected: 下拉框只有当前会话一个选项，文本为字面 `</option><option>x`，没有多出选项。

- [ ] **Step 6: 手动验证后标记完成**

---

### Task 4: 前端 - 新增「重命名」按钮 + renameCurrent() 函数

**Files:**
- Modify: `public/index.html:15` (工具栏，sessionSelect 与 rowsInput 之间插入按钮)
- Modify: `public/index.html` (新增 renameCurrent 函数，放在 killCurrent 附近)

- [ ] **Step 1: 工具栏新增「重命名」按钮**

在 [public/index.html:15](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L15) 的 `<select id="sessionSelect"></select>` 之后、`<input type="number" id="rowsInput"` 之前插入：

```html
        <button onclick="renameCurrent()">重命名</button>
```

- [ ] **Step 2: 新增 renameCurrent 函数**

在 [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) 的 `killCurrent` 函数（约行 170 附近）之后新增：

```js
        function renameCurrent() {
            if (!activeId) return;
            const current = names[activeId] || ('Shell #' + activeId);
            const name = prompt('重命名当前会话', current);
            if (name === null) return;
            ws.send(JSON.stringify({ type: 'rename', id: parseInt(activeId), data: name }));
        }
```

说明：
- `if (!activeId) return` 无活动会话直接返回
- `prompt` 第二参数预填当前名称（自定义名或默认 `Shell #id`）
- `name === null` 表示用户点了「取消」，直接返回不发消息
- `parseInt(activeId)` 保证发给服务端的是数字（服务端 `sessions[id]` 用数字键；`sessions["1"]` 会被 JS 对象的数字键隐式匹配，但显式 parseInt 更安全）
- `data: name` 直接发原文（含空白），服务端 trim 处理

- [ ] **Step 3: 启动并端到端验证完整流程**

Run: `node server.js`

浏览器开 `http://localhost:<端口>`：
1. 点「新建终端」→ 下拉框出现 `Shell #1`（第一个会话自动建）和 `Shell #2`
2. 选中 `Shell #1`，点「重命名」→ prompt 弹出，预填 `Shell #1`
3. 输入"构建"→ 确定 → 下拉框选中项变为"构建"
4. 切到 `Shell #2`，点「重命名」→ 输入"日志"→ 确定 → 下拉框两项为"构建"、"日志"
5. 点"构建" → 下拉框切到该项，终端切到会话 1
6. 再点「重命名」→ prompt 预填"构建"（确认预填当前名而非默认名）
7. 清空输入框 → 确定 → 下拉框回退为 `Shell #1`（空串回退）

- [ ] **Step 4: 验证取消不发送**

选中"构建"会话，点「重命名」→ 点「取消」（或关掉 prompt）→ 下拉框不变，名称仍为"构建"。DevTools Network 确认无 `rename` 消息发出。

- [ ] **Step 5: 手动验证后标记完成**

---

### Task 5: 端到端完整验证（spec 测试清单）

**Files:** 无（仅验证）

- [ ] **Step 1: 准备环境**

Run: `node server.js`，浏览器开 A、B 两个窗口访问 `http://localhost:<端口>`。

- [ ] **Step 2: 执行 spec 测试清单**

按 [spec](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\docs\superpowers\specs\2026-06-25-session-rename-design.md) 「测试清单」逐项验证：

1. 新建会话 → 下拉框显示 `Shell #1` ✓
2. 点「重命名」→ 输入"构建"→ 下拉框与活动选中更新为"构建" ✓
3. 窗口 B → 看到同样的"构建"（多客户端同步）✓
4. 窗口 A 刷新页面 / 重连 → 名称仍在（服务端内存未丢）✓
5. 重命名输入空串 → 回退 `Shell #1` ✓
6. 输入 `<script>alert(1)</script>` 或 `</option>` → 下拉框不破坏、不执行脚本 ✓
7. 输入超长字符串（>50 字符）→ 服务端截断，下拉框正常显示截断后的名称 ✓
8. 关闭会话 → 名称随会话消失 ✓
9. 重启 `node server.js` → 名称消失，回到 `Shell #id` ✓
10. 在窗口 B 重命名 → 窗口 A 下拉框同步更新 ✓

- [ ] **Step 3: 标记全部完成**

如有任一项不符合预期，回到对应 Task 修正。
