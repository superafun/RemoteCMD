# 终端智能命名与一键重命名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-KILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新建终端的命名连续（删除中间会话后新终端仍能接上编号），并提供「重命名全部」按钮一键恢复整齐。所有命名逻辑统一在后端，前端只发指令不参与计算。

**Architecture:** 服务端 `createSession()` 调用新的 `computeSmartName()` 计算初始名（基于最近会话的名字 +1 或兜底用 ID）；新增 `rename_all` 消息处理按 ID 升序覆盖式重命名。前端工具栏新增一个按钮触发 `rename_all`，新增 `renameAll()` 函数。`create` 消息协议不变。

**Tech Stack:** Node.js + Express 5 + ws 8 + node-pty（后端）；HTML + 原生 JS + xterm.js v6（前端，无 bundler）。

**关于验证：** 本项目无测试框架（`package.json` test 为占位 echo，AGENTS.md 明确 "No test framework"）。按用户决策采用**手动验证**替代自动化测试，偏离 TDD skill 默认。每个 task 后手动跑 `node server.js` + 浏览器验证。

**关于 git：** 项目非 git 仓库（AGENTS.md 明确）。无 commit 步骤，每个 task 末尾改为手动验证 + 标记完成。

**参考 spec：** [docs/superpowers/specs/2026-06-28-smart-rename-design.md](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\docs\superpowers\specs\2026-06-28-smart-rename-design.md)

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `server.js` | 修改 | 1) 新增 `computeSmartName()` 辅助函数；2) `createSession()` 改名赋值；3) 新增 `rename_all` 消息分支 |
| `public/index.html` | 修改 | 1) 工具栏新增「重命名全部」按钮；2) 新增 `renameAll()` 函数 |

保持项目"单文件、最简实现"约定：后端 3 处改动 + 前端 2 处改动，互不耦合。

---

### Task 1: 服务端 - 新增 computeSmartName() 并在 createSession 中使用

**Files:**
- Modify: `server.js` (`createSession` 上方新增函数)
- Modify: `server.js:55` (`createSession` 内 sessions 赋值改 name 字段)

- [ ] **Step 1: 新增 computeSmartName() 函数**

在 [server.js:38](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L38) 的 `function createSession() {` 之前插入：

```js
function computeSmartName(fallbackId) {
    // 没有任何会话 → 不起名，让前端用 ID 兜底显示
    const ids = Object.keys(sessions).map(Number).sort((a, b) => b - a);
    if (ids.length === 0) return null;
    const latestId = ids[0];
    // 取最近会话的名字；null 表示用默认 "Shell #" + ID 作为虚拟显示
    const latestName = sessions[latestId].name || ('Shell #' + latestId);
    // 匹配 "Shell #N" 字面量（必须有一个空格）→ 在 N 基础上 +1
    const m = latestName.match(/^Shell #(\d+)$/);
    if (m) return 'Shell #' + (parseInt(m[1]) + 1);
    // 前一个是自定义名 → 用调用方传入的 fallbackId 作为后缀（即 newId）
    return 'Shell #' + fallbackId;
}
```

说明：
- `Object.keys(sessions).map(Number).sort((a, b) => b - a)`：把 sessions 的字符串键转数字后按 ID 降序排序，取第一个（最大 ID）作为"最近会话"
- `null || ('Shell #' + latestId)`：当 `name` 是 null 时（用户从未改过名），用默认显示名参与匹配，仍能匹配上
- 匹配成功则新名 = `Shell #(N+1)`，让编号连续
- 匹配失败（最近是自定义名）则用调用方传入的 `fallbackId`（即当前 `newId`）作为后缀
- **必须传入 newId 而不是读 `sessionCounter`**：因为 `sessionCounter++` 已在调用前执行，sessionCounter 此时已是 `newId + 1`

- [ ] **Step 2: createSession 内 sessions 赋值改用 computeSmartName**

修改 [server.js:55](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L55)：

原：
```js
    sessions[newId] = { pty: ptyProcess, buffer: '', name: null };
```

改为：

```js
sessions[newId] = { pty: ptyProcess, buffer: '', name: computeSmartName(newId) };
```

说明：
- 关键：传入 `newId` 作为兜底值（不是空参数），因为 `sessionCounter++` 已执行，sessionCounter 此时 = newId + 1
- 当 `computeSmartName(newId)` 返回 null（首创建）时，session.name 也是 null，前端下拉框用 `Shell #ID` 兜底显示
- 当返回字符串时，session.name 是显式字符串，前端直接显示

- [ ] **Step 3: 启动并冒烟验证（首创建）**

Run: `node server.js`（如果已运行需 Ctrl+C 重启）

浏览器开 `http://localhost:<端口>`：
1. 默认显示 `Shell #1`（首创建，name=null，前端兜底）
2. 点「新建终端」→ 下拉框出现 `Shell #2`（最近 Shell #1 + 1）✓
3. 再点「新建终端」→ `Shell #3` ✓

- [ ] **Step 4: 验证 ID 空洞场景（核心需求）**

1. 已有 `Shell #1`、`Shell #2`、`Shell #3`
2. 切换到 `Shell #3`，点「关闭终端」→ 自动跳到 `Shell #1`（id 最大原则既有行为）
3. 此时会话实际剩 `{1, 2}`，但 `sessionCounter` 已增到 4
4. 点「新建终端」→ 下拉框应出现 `Shell #3`（最近 Shell #2 + 1），**不是** `Shell #4` ✓

- [ ] **Step 5: 验证自定义名场景**

1. 把 `Shell #1` 改名为「工作台」（手动重命名既有功能）
2. 关闭所有其他终端后（只留「工作台」），点「新建终端」
3. 下拉框应出现 `Shell #<当前 sessionCounter>`（兜底逻辑，正则不匹配）✓

- [ ] **Step 6: 验证全部关闭后重建**

1. 关闭所有终端
2. 点「新建终端」→ 应出现 `Shell #1`（无现有会话 → name=null → 前端兜底）✓

- [ ] **Step 7: 手动验证后标记完成**

（项目无 git，无 commit 步骤。）

---

### Task 2: 服务端 - 新增 rename_all 消息处理

**Files:**
- Modify: `server.js` (消息处理分支末尾新增 rename_all)

- [ ] **Step 1: 在 rename 分支之后新增 rename_all 处理**

修改 [server.js:97-100](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L97) 附近，定位到现有 `rename` 分支：

```js
        else if (type === 'rename' && sessions[id]) {
            const name = (data == null ? '' : String(data)).trim().slice(0, 50);
            sessions[id].name = name === '' ? null : name;
            broadcast(buildListMsg());
        }
```

在闭合大括号之后、`});` 之前（即 `wss.on('message', ...)` 回调内末尾）追加：

```js
        else if (type === 'rename_all') {
            // 按 ID 升序遍历，依次命名为 Shell #1, Shell #2 ...
            const sortedIds = Object.keys(sessions).map(Number).sort((a, b) => a - b);
            sortedIds.forEach((id, i) => {
                sessions[id].name = 'Shell #' + (i + 1);
            });
            broadcast(buildListMsg());
        }
```

说明：
- 位置在 `rename` 分支之后；保持所有消息处理在同一 `else if` 链中，结构对称
- 升序遍历：保证下拉框看到 `Shell #1, #2, #3, ...`，顺序与 ID 一致
- `Object.keys(sessions).map(Number)`：字符串键转数字后用数值比较器排序，避免字典序错误（10 排在 2 前面）
- 覆盖所有现有名字：包括用户手动改过的，符合"重命名全部"语义
- 仍走 `buildListMsg()` 广播，前端自动刷新下拉框

- [ ] **Step 2: 启动并冒烟验证（一键重命名）**

Run: `node server.js`（如果未运行）

1. 浏览器开 `http://localhost:<端口>`，确保有 ≥1 个会话
2. 在 `Shell #1` 上点「重命名」改为「我的终端」
3. 新建几个终端（共 3 个左右）
4. 点「重命名全部」（注意：工具栏还没有这个按钮，需要先用 DevTools 或临时在控制台执行 `ws.send(JSON.stringify({type:'rename_all'}))` 模拟）
5. 下拉框应变成 `Shell #1, Shell #2, Shell #3`，自定义名被覆盖 ✓

> **重要提示：** 步骤 4 用临时手段（控制台 ws.send）模拟按钮，因为按钮在 Task 3 才加。如果不想重启服务两次，可以先完成 Task 3 再一起验证 Task 1 + Task 2 的后端行为。

- [ ] **Step 3: 验证智能命名 + 一键重命名联动**

1. 接着 Step 2 的状态，点「新建终端」
2. 应出现 `Shell #4`（最近 Shell #3 + 1，确认智能命名在显式名后仍生效）✓

- [ ] **Step 4: 手动验证后标记完成**

---

### Task 3: 前端 - 工具栏新增「重命名全部」按钮 + renameAll() 函数

**Files:**
- Modify: `public/index.html` (工具栏新增按钮)
- Modify: `public/index.html` (新增 renameAll 函数)

- [ ] **Step 1: 工具栏新增按钮**

修改 [public/index.html:23](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L23) 工具栏的「重命名」按钮行。

定位原代码：
```html
        <button onclick="renameCurrent()">重命名</button>
```

在它后面（同一行）插入：
```html
        <button onclick="renameAll()">重命名全部</button>
```

完整修改后该行应类似：
```html
        <select id="sessionSelect"></select>
        <button onclick="renameCurrent()">重命名</button>
        <button onclick="renameAll()">重命名全部</button>
        <input type="number" id="rowsInput" min="20" max="200">
```

说明：
- 位置紧跟「重命名」按钮，UI 上把"重命名相关操作"聚在一起
- 不需要修改 CSS/样式，保持工具栏原生浏览器默认外观

- [ ] **Step 2: 新增 renameAll() 函数**

修改 [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html)，在 `renameCurrent()` 函数之后插入新函数。

定位 `renameCurrent()`（约第 190 行）：
```js
    function renameCurrent() {
        if (!activeId) return;
        const current = names[activeId] || ('Shell #' + activeId);
        const name = prompt('重命名当前会话', current);
        if (name === null) return;
        ws.send(JSON.stringify({ type: 'rename', id: parseInt(activeId), data: name }));
    }
```

在它闭合大括号后、`applySize()` 前插入：
```js
    function renameAll() {
        ws.send(JSON.stringify({ type: 'rename_all' }));
    }
```

说明：
- 不需要任何前端参数，服务端 `rename_all` 消息本身不带数据
- 无需确认对话框：用户要求是"一键重命名"，如果担心误操作可以后续加 confirm（YAGNI 不加）
- 消息发出后，服务端会广播 list，前端 ws.onmessage 中 `list` 分支自动用 `names[id]` 重建下拉框（既有逻辑）

- [ ] **Step 3: 启动并端到端验证（按钮触发）**

Run: `node server.js`（如果未运行）

1. 浏览器开 `http://localhost:<端口>`，刷新（确认新代码加载）
2. 现有终端应是默认 `Shell #N` 形式
3. 把某个终端改名为「我的终端」
4. 点击工具栏的「重命名全部」按钮
5. 下拉框应瞬间变成 `Shell #1, Shell #2, ...`（按 ID 升序），自定义名被覆盖 ✓
6. 再点「新建终端」→ 新终端应命名为 `Shell #<现有最大编号 + 1>` ✓

- [ ] **Step 4: 验证多客户端联动**

1. 开两个浏览器窗口（或浏览器 + 无痕窗口）均访问 `http://localhost:<端口>`
2. 在窗口 A 把某个终端改名为「测试A」
3. 在窗口 A 点击「重命名全部」
4. 观察窗口 B：下拉框同步变成 `Shell #1, Shell #2, ...`（服务端广播，list 自动更新）✓
5. 在窗口 A 再点「新建终端」→ A 跳到新终端，窗口 B 下拉框出现新的 `Shell #N` 但 B 视图不变（既有 pendingCreate 隔离行为）✓

- [ ] **Step 5: 手动验证后标记完成**

---

## 不在范围内

- 持久化名字到 config.json（与现有 `rename` 行为一致，不写盘）
- `rename_all` 加 confirm 确认弹窗（YAGNI）
- 智能命名规则可配置化（YAGNI）
- 撤销「重命名全部」（YAGNI）
- 改名冲突检测（服务端唯一权威，无需）
- 自动化测试（项目无测试框架，按用户决策手动验证）

## 自审

- **Spec 覆盖**：
  - 智能命名（spec 目标第 1 条）→ Task 1 完整覆盖
  - 一键重命名（spec 目标第 2 条）→ Task 2 后端 + Task 3 前端完整覆盖
  - 命名逻辑统一后端（spec 目标第 3 条）→ Task 1 + Task 2 都是服务端，前端只发指令
  - 行为示例表中 7 个场景：首创建 / 删中间后新建 / 自定义名后新建 / 全部关闭后重建 / 智能命名 + 一键重命名联动 / 多客户端联动 → Task 1/2/3 的验证步骤分别覆盖
  - 边界情况表 9 项：全部在 Task 1/2/3 的验证步骤中提及
- **无 placeholder**：所有代码块完整可复制
- **类型/方法名一致**：`computeSmartName()` / `rename_all` 单一贯穿所有 task；`renameAll()` / `renameCurrent()` / `applySize()` 与既有命名风格一致
- **TDD 偏离**：本项目无测试框架，按既有约定手动验证
