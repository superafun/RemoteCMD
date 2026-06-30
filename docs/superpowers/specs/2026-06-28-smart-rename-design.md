# 终端智能命名与一键重命名设计

## 背景与目标

当前新建终端的命名是「按后端自增 ID 命名」，存在一个使用上的不连贯：

- 依次创建终端 1、2、3 后关闭 #3，再新建一个新终端
- 后端 `sessionCounter` 仍单调递增，新终端获得 ID = 4
- 下拉框显示变为 `Shell #1`、`Shell #2`、`Shell #4`，编号出现空洞

更根本的问题：当前 `Shell #N` 这种"看起来连续"的命名其实是后端 ID 的衍生品，并没有真正表达"第 N 个会话"的语义。

本功能的目标：

- **新建时智能命名**：当最近一个终端的名字是默认形式 `Shell #N` 时，新终端命名为 `Shell #(N+1)`，让用户的下拉框编号连续
- **一键重命名全部**：工具栏新增「重命名全部」按钮，点击后所有终端按后端 ID 升序重新命名为 `Shell #1`、`Shell #2` …，恢复整齐
- **所有命名逻辑统一在后端**：手动重命名（已有）、新建自动命名、一键重命名都走服务端，前端只发指令不参与计算

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 命名计算位置 | 服务端 | 唯一权威源，避免多客户端命名不一致；前端代码更简单 |
| 智能命名前缀 | `Shell #` 格式不变 | 与现有 `Shell #ID` 保持视觉一致 |
| 一键重命名触发方 | 工具栏新增「重命名全部」按钮 | 用户明确要求，且要可手动恢复整齐 |
| 一键重命名是否覆盖自定义名 | 是 | 用户明确选择"覆盖所有名称" |
| 智能命名匹配范围 | 仅匹配 `Shell #N` 字面量 | 不引入更复杂规则，YAGNI |
| 前一个终端是自定义名时 | 新终端名 = `Shell #<新ID>` | 沿用原"用 ID 作后缀"的兜底逻辑 |
| 是否扩展 `create` 消息协议 | 否 | 保持原协议纯净，名字由服务端根据当前状态计算 |
| 是否持久化名字 | 否 | 与现有 `rename` 行为一致，名字是会话运行时属性 |

## 数据流

### 场景 A：智能命名（新建）

```
Client 点击「新建终端」
  │
  └─ ws.send({type:'create'})

Server createSession()
  │
  ├─ newId = sessionCounter++
  ├─ pty.spawn(powershell.exe)
  ├─ smartName = computeSmartName()  ← 关键
  │     ├─ 取所有 sessions 中 ID 最大的会话
  │     ├─ 取其名字（null → 用 "Shell #" + 最新ID 作为虚拟默认名）
  │     ├─ 匹配 ^Shell\s*#(\d+)$  正则
  │     │     ├─ 成功 → 返回 "Shell #" + (N+1)
  │     │     └─ 失败 → 返回 "Shell #" + sessionCounter  ← 兜底
  │     └─ 注意：sessionCounter 此时已是 newId（自增已完成）
  ├─ sessions[newId] = { pty, buffer:'', name: smartName }
  └─ broadcast({type:'list', ids, names})

Client 收到 list
  └─ 下拉框用 names[id] 渲染，显示 smartName
```

### 场景 B：一键重命名

```
Client 点击「重命名全部」
  │
  └─ ws.send({type:'rename_all'})

Server 处理 rename_all
  │
  ├─ sortedIds = Object.keys(sessions).map(Number).sort((a,b)=>a-b)
  ├─ sortedIds.forEach((id, i) => sessions[id].name = 'Shell #' + (i+1))
  └─ broadcast({type:'list', ids, names})
```

## 行为示例

| 操作序列 | 后端 sessions 状态 | 列表显示 |
|---------|------------------|---------|
| 新建 ×3 | `{1:Shell #1, 2:Shell #2, 3:Shell #3}` | Shell #1, Shell #2, Shell #3 |
| 关闭 #3 后新建 | `{1:Shell #1, 2:Shell #2, 4:Shell #3}` | Shell #1, Shell #2, Shell #3 ✓ |
| 把 #2 改名为「工作台」后新建 | `{1:Shell #1, 2:工作台, 3:Shell #3}` | Shell #1, 工作台, Shell #3 |
| 上一步后点击「重命名全部」 | `{1:Shell #1, 2:Shell #2, 3:Shell #3}` | Shell #1, Shell #2, Shell #3 |
| 重命名全部后再新建 | `{1:Shell #1, 2:Shell #2, 3:Shell #3, 4:Shell #4}` | Shell #1…Shell #4 ✓ |
| 首次创建（无现有会话） | `{1:null}` | Shell #1（names[1] 为 null，前端用 ID 兜底显示） |
| 所有终端关掉后再新建 | `{1:Shell #1}`（旧 freeId 复用不受影响） | Shell #1 |

## 服务端改动（server.js）

### 1. 新增 computeSmartName() 函数

放在 `createSession` 上方：

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
    // 前一个是自定义名 → 用即将分配的新 ID 作为后缀（由调用方传入）
    return 'Shell #' + fallbackId;
}
```

### 2. createSession() 改名赋值

[server.js:55](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js#L55) 原代码：

```js
sessions[newId] = { pty: ptyProcess, buffer: '', name: null };
```

改为：

```js
sessions[newId] = { pty: ptyProcess, buffer: '', name: computeSmartName(newId) };
```

说明：
- 调用时机：`sessionCounter++` 已在上一行执行（`const newId = sessionCounter++`），所以传入 `newId` 作为兜底值
- 兜底场景（最近是自定义名）下返回 `'Shell #' + newId`，确保用刚分配的 ID 而非已被自增的 sessionCounter
- 当 `computeSmartName()` 返回 null（首创建）时，session.name 也是 null，前端下拉框用 `Shell #ID` 兜底显示
- 当返回字符串时，session.name 是显式字符串，前端直接显示

### 3. 新增 rename_all 消息处理

在现有消息分支末尾（`rename` 分支之后）新增：

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

> **关于 `.map(Number).sort((a, b) => a - b)` 的说明**
>
> `Object.keys(sessions)` 返回的是字符串数组（如 `["1", "4", "2"]`）。如果直接 `.sort()`，是按字典序排序——当 ID 跨过 10 后会出错：例如 `["1", "2", "10"].sort()` 字典序结果仍是 `["1", "10", "2"]`，导致 `Shell #10` 排在 `Shell #2` 前面。
>
> 处理方式：先 `.map(Number)` 把字符串转成数字 `[1, 4, 2]`，再用数值比较器 `.sort((a, b) => a - b)` 做升序排序，得 `[1, 2, 4]`。
>
> 比较器语义：
> - `a - b < 0` → a 排前面
> - `a - b > 0` → a 排后面
> - `a - b === 0` → 等价，保持原序
>
> 降序反过来写：`.sort((a, b) => b - a)`。

`create` 分支无需修改（保持 `createSession()` 不带参数调用）。

## 前端改动（public/index.html）

### 1. 工具栏新增按钮

[public/index.html:23](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L23) 工具栏行新增一个按钮：

```html
<button onclick="renameAll()">重命名全部</button>
```

位置：放在「重命名」按钮之后，「确定（行数）」之前。

### 2. 新增 renameAll() 函数

放在 `renameCurrent()` 函数附近：

```js
function renameAll() {
    ws.send(JSON.stringify({ type: 'rename_all' }));
}
```

### 3. createNew() 保持原样

无需修改，仍是：

```js
function createNew() {
    pendingCreate = true;
    ws.send(JSON.stringify({ type: 'create' }));
}
```

## 通信协议变化

### 客户端 → 服务端

| type | 变化 | 说明 |
|------|------|------|
| `create` | 不变 | 仍是不带任何附加字段，服务端自行为新会话算名字 |
| `rename_all` | **新增** | 无参数，触发服务端按 ID 升序覆盖式重命名 |
| `rename` | 不变 | 原有手动重命名 |

### 服务端 → 客户端

无新消息类型。`list` 消息已经携带 `names` 字段，前端按原样渲染。

## 边界情况

| 场景 | 处理 |
|------|------|
| 没有任何会话时新建 | `computeSmartName()` 返回 `null` → `sessions[id].name = null` → 前端用 `Shell #ID` 兜底显示 |
| 所有终端被关掉后新建 | `ids.length === 0` → 同上 |
| 最近终端是自定义名（如「工作台」） | 正则不匹配 → 返回 `Shell #<sessionCounter>`（此时等于 newId） |
| 最近终端是手动改成的「Shell #5」 | 正则匹配 → 返回 `Shell #6` |
| 自动重命名后立即新建 | 最近终端是 `Shell #N`（显式设置）→ 匹配 → 新终端 `Shell #(N+1)` |
| ID 中间有空洞（如 1、3、4） | 取 ID 最大的 4 的名字 `Shell #4` → 新终端 `Shell #5` |
| 多客户端同时点击新建 | 服务端串行处理（JS 单线程），各自得到不同 ID，名字按创建时算 |
| `rename_all` 时无任何会话 | `sortedIds` 为空 → forEach 不执行 → 仍广播空 list |
| 名字长度 | 沿用 `rename` 现有的 `slice(0, 50)` 限制（如果未来需要也可在 `computeSmartName` 输出上截断，但 `Shell #N` 形式很短不会超） |

## 改动文件清单

| 文件 | 改动量 | 性质 |
|------|--------|------|
| [server.js](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\server.js) | +18 行 / 改 1 行 | 新增 `computeSmartName()`、`rename_all` 分支；`createSession` 一行改名赋值 |
| [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) | +3 行 / 改 0 行 | 工具栏加按钮 + `renameAll()` 函数 |

总计后端约 20 行、前端 3 行纯增量改动。

## 不在本次范围

- 持久化名字到 config.json（与现有 `rename` 行为一致，不写盘）
- 名字冲突检测（服务端唯一权威，无需）
- 智能命名规则可配置化（YAGNI）
- 重命名时保留或排除某些终端的开关（YAGNI）
- 「撤销重命名」功能（YAGNI）
