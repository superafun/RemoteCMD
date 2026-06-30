# 会话重命名功能设计

## 背景与目标

当前前端会话切换器是一个 `<select>` 下拉框，每个会话的标签固定为 `Shell #<id>`（如 `Shell #1`、`Shell #2`），由服务端数字 ID 自动生成，用户无法区分用途不同的会话。

本功能允许用户为每个会话自定义名称（如"构建服务器"、"日志查看"），并在下拉框中显示。名称随会话存活，多客户端同步。

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| UI 形态 | 保留下拉框 `<select>` | 改动最小，符合现有 UI |
| 重命名触发 | 工具栏「重命名」按钮 | `<select>` 原生不可编辑，按钮触发最直接 |
| 输入框形态 | 浏览器原生 `prompt()` | 项目"最简实现"风格，零额外 HTML/CSS |
| 名称生命周期 | 随会话存活（服务端内存） | 符合现有会话模型，服务端重启即重置可接受 |

## 数据模型

### 服务端 sessions 对象

每个 session 增加可选 `name` 字段：

```js
sessions[newId] = { pty: ptyProcess, buffer: '', name: null };
```

- `name === null`（或空串）→ 前端回退显示默认标签 `Shell #<id>`
- `name` 为非空字符串 → 前端显示该字符串
- 名称随会话生灭，仅存内存，不持久化到 `config.json`

## 协议变更

### Server → Client：扩展 `list` 消息

复用现有 `list` 消息，附带名称映射：

```js
{
  type: 'list',
  ids: ['1', '2'],
  names: { '1': null, '2': '构建服务器' }
}
```

**为什么复用 `list` 而非新增消息类型**：
- 客户端 `list` 处理器是幂等的（仅在 `!terms[id]` 时创建终端实例），重广播安全
- 重命名后服务端重新广播 `list`，客户端现有"重建下拉框"逻辑天然刷新标签
- 减少协议消息类型数量，符合项目"最简实现"约定

### Client → Server：新增 `rename` 消息

```js
{ type: 'rename', id: 2, data: '构建服务器' }
```

## 服务端改动（server.js）

### 1. createSession()

session 对象初始化 `name: null`：

```js
sessions[newId] = { pty: ptyProcess, buffer: '', name: null };
```

### 2. broadcast({ type: 'list', ... })

所有发送 `list` 消息的位置统一带上 `names`，包括：
- `createSession()` 末尾的 `broadcast`
- 进程退出 `onExit` 中的 `broadcast`
- 新连接 `wss.on('connection')` 时单独 `ws.send` 的那条

`names` 的构造：

```js
const names = {};
for (const id of Object.keys(sessions)) {
    names[id] = sessions[id].name;
}
broadcast({ type: 'list', ids: Object.keys(sessions), names });
```

建议抽一个 `buildListMsg()` 辅助函数避免三处重复构造。

### 3. 新增 rename 处理

在 `ws.on('message')` 的 type 分发中新增：

```js
else if (type === 'rename' && sessions[id]) {
    const name = (data == null ? '' : String(data)).trim().slice(0, 50);
    sessions[id].name = name === '' ? null : name;
    broadcast(buildListMsg());
}
```

- `trim()` 去除首尾空白
- `.slice(0, 50)` 截断，防止撑爆工具栏
- 空串/纯空白 → 置 `null`（回退默认）
- 不存在的 `id` → 忽略（不报错、不广播）

## 前端改动（public/index.html）

### 1. 工具栏新增「重命名」按钮

在 `<select id="sessionSelect">` 与 `<input id="rowsInput">` 之间插入：

```html
<button onclick="renameCurrent()">重命名</button>
```

### 2. 维护名称映射

新增模块级变量：

```js
let names = {};
```

在 `list` 消息处理器开头更新：

```js
if (msg.names) names = msg.names;
```

### 3. 重建下拉框选项（安全化）

现有代码（[行 92-96](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L92-L96)）用 `innerHTML` 拼接，存在 XSS 和 `</option>` 破坏下拉框风险。改为 DOM API + `textContent`：

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

`textContent` 自动转义，杜绝用户输入的 HTML 注入。

### 4. renameCurrent() 函数

```js
function renameCurrent() {
    if (!activeId) return;
    const current = names[activeId] || ('Shell #' + activeId);
    const name = prompt('重命名当前会话', current);
    if (name === null) return;                // 用户取消
    ws.send(JSON.stringify({ type: 'rename', id: parseInt(activeId), data: name }));
}
```

- `name === null` 表示用户点了「取消」，直接返回不发送
- `id` 用 `parseInt` 保证是数字（服务端 `sessions[id]` 用数字键）

### 5. 选中项保持

重命名后服务端广播新 `list`，步骤 3 重建下拉框时 `id == activeId` 的 option 自带 `selected`，活动会话的选中状态自动保持，无需额外处理。

## 边界与错误处理

| 场景 | 行为 |
|------|------|
| 空名 / 纯空白 | 服务端置 `null`，前端回退 `Shell #<id>` |
| 名称超长 | 服务端截断至 50 字符 |
| 名称含 HTML（如 `<script>`、`</option>`） | 前端用 `textContent` 设置，安全转义 |
| 重命名已关闭的会话（id 不存在） | 服务端忽略，不报错 |
| `prompt()` 取消（返回 null） | 前端不发消息，状态不变 |
| 服务端重启 | 会话和名称都消失，回到 `Shell #<id>` |
| 多客户端 | 任一客户端重命名后，所有客户端经 `list` 广播同步刷新 |

## 测试清单（手动）

无测试框架，按以下步骤手动验证：

1. 新建会话 → 下拉框显示 `Shell #1`
2. 点「重命名」→ 输入"构建"→ 下拉框与活动选中更新为"构建"
3. 开第二个浏览器窗口 → 看到同样的"构建"（多客户端同步）
4. 刷新页面 / 重连 → 名称仍在（服务端内存未丢）
5. 重命名输入空串 → 回退 `Shell #1`
6. 输入 `<script>alert(1)</script>` 或 `</option>` → 下拉框不破坏、不执行脚本
7. 输入超长字符串（>50 字符）→ 服务端截断，下拉框正常显示截断后的名称
8. 关闭会话 → 名称随会话消失
9. 重启 `node server.js` → 名称消失，回到 `Shell #<id>`
10. 在第二个客户端重命名 → 第一个客户端下拉框同步更新

## 不在范围内

以下事项明确不在本次实现范围：

- 名称持久化到 `config.json`（按用户选择，仅随会话存活）
- 改为标签栏 UI（按用户选择，保留下拉框）
- 自定义模态框（按用户选择，用 `prompt()`）
- 会话排序 / 拖拽重排
