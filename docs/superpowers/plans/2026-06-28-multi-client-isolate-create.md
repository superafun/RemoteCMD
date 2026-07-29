# 多客户端创建终端隔离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多客户端连接时，创建者点击「新建终端」后自动跳到新终端，其他客户端保持当前视图不变，新终端在后台默默创建。

**Architecture:** 纯前端方案。模块级 `pendingCreate` 布尔标志记录"刚才那个 create 请求是不是我发的"。`createNew()` 置位，`createTermInstance(id)` 末尾消费（决定是否 `switchSession`），WS 断连时复位。服务端零改动。

**Tech Stack:** HTML + 原生 JS + xterm.js v6（前端，无 bundler）。无服务端改动。

**关于验证：** 本项目无测试框架（`package.json` test 为占位 echo，AGENTS.md 明确 "No test framework"）。按用户决策采用**手动验证**替代自动化测试，偏离 TDD skill 默认。

**关于 git：** 项目非 git 仓库（AGENTS.md 明确）。无 commit 步骤，每个 task 末尾改为手动验证 + 标记完成。

**参考 spec：** [docs/superpowers/specs/2026-06-28-multi-client-isolate-create-design.md](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\docs\superpowers\specs\2026-06-28-multi-client-isolate-create-design.md)

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `public/index.html` | 修改 | 1) 新增 `pendingCreate` 变量；2) `createNew()` 置位；3) `createTermInstance()` 末尾消费并条件切换；4) `ws.onclose` 复位 |

保持项目"单文件、最简实现"约定：4 处改动全部集中在前端一个文件，新增 1 个变量、修改 3 个函数。

---

### Task 1: 前端 - pendingCreate 状态机 4 处改动

**Files:**
- Modify: `public/index.html` (模块级变量区，新增 1 行)
- Modify: `public/index.html` (`createNew` 函数，加 1 行)
- Modify: `public/index.html` (`createTermInstance` 函数末尾，改条件切换)
- Modify: `public/index.html` (`connect` 函数内的 ws 创建处，加 onclose 复位)

- [ ] **Step 1: 新增 pendingCreate 模块级变量**

在 [public/index.html:22](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L22) `let editorDiv = null;` 下方新增一行：

```js
        let pendingCreate = false;
```

- [ ] **Step 2: createNew() 置位**

修改 [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) 的 `createNew` 函数，原：

```js
        function createNew() {
            ws.send(JSON.stringify({ type: 'create' }));
        }
```

改为：

```js
        function createNew() {
            pendingCreate = true;
            ws.send(JSON.stringify({ type: 'create' }));
        }
```

- [ ] **Step 3: createTermInstance 末尾条件切换**

修改 [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) 的 `createTermInstance` 函数末尾。

原（约行 154-156）：

```js
            ws.send(JSON.stringify({ type: 'buffer', id: id }));
            switchSession(id);
        }
```

改为：

```js
            ws.send(JSON.stringify({ type: 'buffer', id: id }));
            // 仅当本客户端刚刚发起过 create 时，才跳到新终端
            if (pendingCreate) {
                pendingCreate = false;
                switchSession(id);
            }
        }
```

说明：
- 这是整个机制的核心消费点：`pendingCreate` 为 true 表示"我刚发过 create，新来的这个 ID 应当属于我"，因此切换并消费标志
- `pendingCreate` 为 false 时（来自他人 create）函数到此结束，xterm 实例已创建但不切换
- 消费后立即清零，避免影响后续 list 消息中的其他新 ID

- [ ] **Step 4: ws.onclose 复位**

修改 [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) 的 `connect` 函数，在 `ws = new WebSocket(...)` 之后追加 onclose 处理器。

原（约行 57-59）：

```js
        function connect() {
            if (!ws || ws.readyState === 3) {
                console.log('重新连接服务器');
                ws = new WebSocket(`${wsProtocol}://${location.host}/cmd/`);
                ws.onmessage = (event) => {
```

改为（紧接 `ws = new WebSocket(...)` 行之后、`ws.onmessage` 之前）插入 onclose：

```js
        function connect() {
            if (!ws || ws.readyState === 3) {
                console.log('重新连接服务器');
                ws = new WebSocket(`${wsProtocol}://${location.host}/cmd/`);
                ws.onclose = () => { pendingCreate = false; };
                ws.onmessage = (event) => {
```

说明：
- WS 断连时立即清空标志位，防止"点击新建 → 立即断网 → 重连后误把焦点切到别人的新终端"
- 防御性复位，1 行换 0 个潜在 bug
- 此处赋值给新创建的 ws 对象（不是旧 ws），因为 `connect` 已确认 `readyState === 3` 才会进入新建分支

- [ ] **Step 5: 启动并冒烟验证（单客户端）**

Run: `node server.js`

浏览器开 `http://localhost:<端口>`：
1. 默认显示 `Shell #1`
2. 点「新建终端」→ 立即跳到 `Shell #2`（创建者行为不变）✓
3. 再点一次「新建终端」→ 跳到 `Shell #3` ✓
4. 关闭 `Shell #3`（kill 当前）→ 自动跳到 `Shell #1`（现有行为）✓

冒烟通过表示改动未破坏单客户端基础流程。

- [ ] **Step 6: 手动验证后标记完成**

（项目无 git，无 commit 步骤。）

---

### Task 2: 端到端验证 - 2 浏览器窗口多客户端行为

**Files:**
- 无文件改动

- [ ] **Step 1: 准备 2 个浏览器窗口**

Run: `node server.js`（如果未运行）

开两个浏览器窗口（推荐用 Chrome + Edge，或同一浏览器的 2 个无痕窗口以隔离 sessionStorage），均访问 `http://localhost:<端口>`。

Expected: 两个窗口默认各显示 `Shell #1`（因为首次连接时若无会话会自动创建一个；第二个窗口连接时已存在会话，因此不新建，共享 `Shell #1`）。

如只显示一个窗口的 `Shell #1`、另一个没有会话，请在其中一个窗口点「新建终端」让两端各自至少有一个会话。

- [ ] **Step 2: 验证创建者跳、旁观者不跳**

1. 在窗口 A 点击「新建终端」
2. 观察窗口 A：应立即跳到新建的 `Shell #2`（或 `#3`，取决于已有会话数）✓
3. 观察窗口 B：仍显示其原 `Shell #1` 视图，**不**跳到新终端 ✓
4. 检查窗口 B 的下拉框：包含新终端选项 ✓

- [ ] **Step 3: 验证 B 端可手动切换到 A 新建的终端**

在窗口 B 点击下拉框，选择 A 刚创建的 `Shell #2`。

Expected: B 正常切换，xterm 渲染 A 新终端的 PowerShell 提示符（含 buffer 回放）。

- [ ] **Step 4: 验证对端创建不影响当前焦点**

1. 在窗口 A 切换到任意会话（确保 A 也有非默认的 active）
2. 在窗口 B 点击「新建终端」→ B 跳到 B 的新终端
3. 观察窗口 A：仍显示 A 刚才切到的会话，**不**跟随 B 的新终端 ✓

- [ ] **Step 5: 验证连续点「新建」幂等行为**

在窗口 A 连续快速点击「新建终端」3 次：

Expected: A 依次（或直接落到最后一个）跳到新终端之一，下拉框新增 3 个会话项，但 A 不会"在它们之间反复横跳"——只切到第一个新终端的创建时刻。

说明：`pendingCreate` 是布尔，多次点击只是反复置 true（幂等）；`createTermInstance` 末尾只消费一次，跳到第一个新 ID 后标志清零。后续 list 消息中再出现新 ID 时已被消费。

- [ ] **Step 6: 验证 kill 同步不影响当前焦点**

1. 窗口 A 切换到 A 专属的某个会话
2. 窗口 B 关闭（kill）B 当前显示的会话
3. 观察窗口 A：仍显示 A 切到的会话，list 同步移除已 kill 的会话（如下拉框少了一项），但 A 不被强制跳转 ✓

- [ ] **Step 7: 验证 WS 断连复位（防御性）**

1. 在终端里手动停止 `node server.js`（Ctrl+C）
2. 浏览器窗口 A 状态指示器变 "已断连"（红色）
3. 重新启动 `node server.js`
4. 浏览器自动重连后，状态变 "已连接"
5. 此时在窗口 B 点击「新建终端」
6. 观察窗口 A：仍显示 A 当前会话，**不**误切到 B 的新终端 ✓

说明：即使此前 A 的 `pendingCreate` 因断网残留，Step 1/4 的 onclose 已清空。

- [ ] **Step 8: 手动验证后标记完成**

---

## 不在范围内

- 服务端标识 create 触发者（按用户决策，纯前端方案）
- 提供「跟随新终端」配置开关（YAGNI）
- 改动 `list` 协议、新增消息类型
- 改动 `switchSession` 行为或工具栏 UI
- 自动化测试（项目无测试框架，按用户决策手动验证）

## 自审

- **Spec 覆盖**：spec 4 处前端改动 + 边界场景（断连、连续点击、kill 同步）均有 task 验证
- **无 placeholder**：所有代码块完整可复制
- **类型/方法名一致**：`pendingCreate` 单一变量贯穿所有 step，`createTermInstance` / `createNew` / `connect` 函数名与原文件一致
- **TDD 偏离**：本项目无测试框架，按既有约定手动验证
