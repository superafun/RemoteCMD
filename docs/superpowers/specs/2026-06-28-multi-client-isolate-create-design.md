# 多客户端创建终端隔离设计

## 背景与目标

当前存在一个多客户端使用上的不便：当多个浏览器同时连接服务器时，**任一客户端点击「新建终端」后，所有客户端都会被强制切换到新终端**。

根因在 [public/index.html](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html) 的 `createTermInstance(id)`：该函数无论是谁触发的 create，末尾都无条件调用 `switchSession(id)`，导致所有客户端的当前视图被覆盖。

本功能的目标：

- **创建者**：点击「新建终端」后自动跳到新终端（保持当前体验）
- **其他客户端**：保持当前显示的终端不变，新终端在后台默默创建
- 新终端在所有客户端的下拉框中均可见，需要时可手动切换

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 实现层 | 纯前端 | 服务端无字段表明 create 触发者，引入需扩协议；前端用一个 boolean 即可识别 |
| 状态保存方式 | 模块级 `pendingCreate` 标志 | 唯一需要识别的语义："刚才那个 create 请求是不是我发的" |
| 标志位生命周期 | createNew 置位、createTermInstance 消费、WS 断连复位 | 与 create 请求的端到端生命周期严格对齐 |
| 是否扩展服务端协议 | 否 | 改动局限在前端，对其他功能零影响 |
| 是否提供「跟随新建」开关 | 否 | YAGNI，当前诉求只有"不强制跳转"，未要求可配置 |

## 数据流

修复后的端到端流程：

```
Client A 点击「新建终端」
  │
  ├─ 1) 前端 pendingCreate = true
  └─ 2) ws.send({type:'create'})

Server 收到 create
  │
  ├─ 3) pty.spawn(powershell.exe) 创建进程
  └─ 4) broadcast({type:'list', ids, names})  ← 全员广播

Client A 收到 list
  │
  ├─ 检测到新 ID
  ├─ createTermInstance(newId)
  │     └─ 末尾：pendingCreate 为 true → 消费并 switchSession(newId)
  └─ 表现：跳到新终端 ✓

Client B 收到 list
  │
  ├─ 检测到新 ID
  ├─ createTermInstance(newId)
  │     └─ 末尾：pendingCreate 为 false → 不 switch
  └─ 表现：当前视图保持，下拉框多一项 ✓
```

## 前端改动（仅 public/index.html）

### 1. 新增模块级变量

在现有 `let names = {};` 附近新增：

```js
let pendingCreate = false;
```

### 2. createNew() 置位

```js
function createNew() {
    pendingCreate = true;
    ws.send(JSON.stringify({ type: 'create' }));
}
```

### 3. createTermInstance(id) 末尾消费

原代码末尾：

```js
ws.send(JSON.stringify({ type: 'buffer', id: id }));
switchSession(id);
```

改为：

```js
ws.send(JSON.stringify({ type: 'buffer', id: id }));
// 仅当本客户端刚刚发起过 create 时，才跳到新终端
if (pendingCreate) {
    pendingCreate = false;
    switchSession(id);
}
```

`list` 处理逻辑保持原样，无需修改：

```js
currentIds.forEach(id => {
    if (!terms[id]) createTermInstance(id);
});
```

### 4. WebSocket 断连时复位

在 `connect()` 中给 `ws` 增加 `onclose` 处理：

```js
ws.onclose = () => { pendingCreate = false; };
```

或合并到现有 `updateWsStatus()` 的断连分支。任选一处，确保 WS 断开时标志位被清零。

## 边界与错误处理

| 场景 | 行为 |
|------|------|
| 创建者点击后正常收到 list | pendingCreate 消费，切换到新终端 |
| 旁观者收到 list | pendingCreate 为 false，终端后台创建，不切视图 |
| 短时间内连续点击两次「新建」 | 两次都置 true（幂等），只跳到第一个新终端，其余后台创建 |
| 同一 list 消息中含多个新 ID（理论） | 只对第一个新 ID 走 switchTo 分支，其余后台创建 |
| 点击后 WS 立即断连 | onclose 清空 pendingCreate；重连后不会误切 |
| 服务端宕机未广播 list | pendingCreate 随断连清空，无残留 |
| 用户从下拉框手动切换到他人新建的终端 | 行为不变，与单客户端体验一致 |
| 新终端 buffer 回放 | 与原逻辑一致，新 xterm 实例触发后请求 buffer 并写入 |

## 测试清单（手动，2 个浏览器窗口）

无测试框架，按以下步骤手动验证：

1. 两个浏览器窗口均连接到 `http://localhost:<端口>`
2. 默认各显示 `Shell #1`
3. 窗口 A 点击「新建终端」→ A 跳到 `Shell #2`；B 仍显示 `Shell #1` ✓
4. 窗口 B 的下拉框中已包含 `Shell #2` 选项
5. 窗口 B 从下拉框手动选 `Shell #2` → 正常显示，buffer 回放正确
6. 窗口 B 点击「新建终端」→ B 跳到 `Shell #3`；A 仍显示其当前会话 ✓
7. 连续点两次「新建」→ 仅跳到第一个新建的，另一个在后台
8. 关闭窗口 A → 窗口 B 的 list 同步移除 A 的活动会话，B 视图保持
9. 关闭他人新建的终端 → list 同步移除，两端下拉框均刷新
10. 在窗口 A 触发新建后立即刷新页面 → 重连后正常，无残留状态错误

## 不在范围内

- 服务端标识 create 触发者（按用户选择，纯前端方案）
- 提供「跟随新终端」配置开关（YAGNI）
- 改动 `list` 协议或新增消息类型
- 改动 `switchSession` 行为或工具栏 UI
