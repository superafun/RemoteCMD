# 删除终端后跳转到最大 ID 设计

## 背景与目标

当前在 [public/index.html:111](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L111) 处的行为是：当前会话被 kill 后，自动跳到下拉框中的**第一个**会话（`switchSession(currentIds[0])`）。这往往不是用户期望的目标——他们可能想继续查看最近创建的会话。

本功能的目标：

- **当前**会话被 kill 后，自动跳转到当前列表中**ID 最大的会话**（即"最"新创建的）
- 非当前会话被 kill 不触发跳转
- 跳到第一个被 kill 这种"无前一个"的边界情况时，仍然跳到列表第一个（兜底）

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 跳转目标 | ID 最大的会话 | 服务端 `sessionCounter++` 单调递增，ID 大小即创建顺序；最直观也最简单 |
| 跳转触发条件 | 仅当 `activeId` 被 kill 后变为 null 时 | 保持原有"只在失去当前会话时才跳"语义 |
| 非当前会话被 kill | 不触发任何跳转 | 原有 `if (activeId === id) activeId = null` 守卫已保证 |
| 是否记录历史栈 | 否 | YAGNI，单次 ID max 已满足需求 |
| 实现层 | 纯前端 | 服务端协议不变 |

## 数据流

```
Client 当前在 Shell #3
  │
  ├─ 点「关闭终端」→ ws.send({type:'kill', id:'3'})
  ▼
Server 杀掉 powershell.exe(3) → 广播 {type:'list', ids:[1,2,4], names:...}
  ▼
Client 收到 list
  │
  ├─ 清理 terms['3']、wrappers['3']
  ├─ activeId === '3' → activeId = null
  ├─ if (!activeId && currentIds.length > 0)
  │     └─ currentIds = ['1','2','4'] → reduce 取最大 → '4'
  │        switchSession('4')  // 跳到最新创建的会话 ✓
  └─ 重建下拉框，新选中 Shell #4
```

## 前端改动（仅 public/index.html）

### 1. 修改 list 处理器中的兜底跳转

[public/index.html:111](file:///c:\Users\fmy3\OneDrive\project\pythonProjectRemoteCMD\public\index.html#L111) 处：

**原代码：**
```js
                        if (!activeId && currentIds.length > 0) {
                            switchSession(currentIds[0]);
                        }
```

**改为：**
```js
                        if (!activeId && currentIds.length > 0) {
                            // kill 当前会话后，跳到 ID 最大的会话（最新创建）
                            switchSession(currentIds.reduce((a, b) => +a > +b ? a : b));
                        }
```

### 语法说明

| 片段 | 含义 |
|------|------|
| `currentIds.reduce(cb)` | 数组的"折叠"方法，从左到右两两比较，最终返回一个值 |
| `(a, b) => +a > +b ? a : b` | 回调：比较 `a`、`b` 的数值大小，返回大的那个 |
| `+a`、`+b` | 一元加运算符，把字符串转为数字（如 `+'3'` → `3`）|
| `条件 ? A : B` | 三元运算符，真返回 A、假返回 B |

**示例**（`currentIds = ['1', '2', '4', '3']`）：

| 步骤 | a | b | `+a > +b` | 返回 |
|------|---|---|-----------|------|
| 1 | `'1'` | `'2'` | false | `'2'` |
| 2 | `'2'` | `'4'` | false | `'4'` |
| 3 | `'4'` | `'3'` | true | `'4'` |

最终 `'4'` 传给 `switchSession`。

## 边界与错误处理

| 场景 | 行为 |
|------|------|
| 当前会话被 kill，列表还有其他会话 | 跳到 ID 最大的会话 ✓ |
| 当前会话是 ID 最小的（被 kill 后无更小 ID） | reduce 返回的就是当前列表第一个（ID 最小即最大），行为退化为"跳到第一个"，与原行为一致 |
| 唯一会话被 kill（列表为空） | `currentIds.length > 0` 为 false，不触发跳转，等待下次 list |
| 多个会话同时被 kill（含当前） | 同样跳到剩余会话中 ID 最大的 |
| kill 的不是当前会话 | `if (activeId === id)` 守卫阻止 activeId 变更，不触发跳转 |
| 首次连接（activeId 本来就是 null） | 现有逻辑：`if (!activeId && currentIds.length > 0)` 也会命中，会跳到 ID 最大值；这与原"跳到第一个"行为略有不同，但符合"跳到最新创建的会话"的语义 |

**关于首次连接的副作用说明：**
- 原行为：跳到下拉框第一个（也是 ID 最小，因为新连接时通常只有 1 个会话）
- 新行为：跳到 ID 最大（当只有 1 个会话时也即"第一个"）
- 当只有 1 个会话时两者无差异；当已有多个会话时新连接进入的就是"最新创建"的那个

## 测试清单（手动 + Playwright 自动化）

### 手动验证

1. 创建 3 个会话，停在 `Shell #2`
2. kill `Shell #2` → 跳到 `Shell #3`（最大 ID）✓
3. kill `Shell #3` → 跳到 `Shell #1`（唯一剩余）✓
4. kill `Shell #1` → 列表空，无跳转（控制台无报错）
5. 创建 4 个会话，停在 `Shell #1`，kill `Shell #4`（非当前）→ 仍在 `Shell #1`，不跳 ✓

### Playwright 自动化

按上次多客户端功能的相同思路（headless 双 context），覆盖：

- 停在中间会话 → kill → 跳到最大 ID
- 停在最小 ID → kill → 兜底跳到第一个
- kill 非当前 → 不跳
- 连续 kill 多个 → 跳到剩余最大
- 多客户端：A 端 kill 不影响 B 端的 activeId

## 不在范围内

- 跳转到"下拉框前一个"（按用户决策，跳最大 ID）
- 记录会话访问历史栈（YAGNI）
- 跳转到"最近查看过的"（YAGNI）
- 改动服务端协议
- 提供 UI 让用户选择跳转策略
