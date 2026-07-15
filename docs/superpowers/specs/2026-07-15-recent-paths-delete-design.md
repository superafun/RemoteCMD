# 最近路径：单条删除

- 日期：2026-07-15
- 状态：设计已确认，待写实现计划

## 背景

「最近路径」功能（2026-07-15 实现）会把终端/输入条里敲出的本地盘符路径自动收集进
`config.recentPaths`（≤10 条、去重、置顶），经 `config.json` + WebSocket 多端同步，
顶部「最近路径」按钮弹出下拉，点每条路径即复制到剪贴板。

本次需求：用户可以**自己单条删除**某条路径，而不必等它被新路径挤掉或手动改 `config.json`。

约束（沿用用户既有强约束）：
- 用户数据（含最近路径）一律走 `config.json` + WebSocket 多端同步，不落 localStorage。
- 多端同步的变更必须记进前端日志（与其他设置项同步一致），用 `addFrontendLog(msg, 'in')`。

## 交互设计

- 下拉里**每条路径行右侧**加一个 `✕` 删除按钮。
- 点路径行的**其余位置** → 仍复制该路径（保持现有行为）。
- 点 `✕` → 直接删除，**不做二次确认**，删除后弹 `showToast('已删除','success')` 轻提示。
- 删除立即对所有已连接客户端生效（server 是单一数据源）。

## 数据流

```
前端点 ✕
  → wsSend({ type: 'recent_paths_delete', data: path })
  → server.removeRecentPath(path):
        从 config.recentPaths 移除该 path
        → saveConfig(config)            // 落盘 config.json
        → broadcast({ type: 'recent_paths', data: config.recentPaths, deleted: path })
  → 所有前端 ws.onmessage 收到 recent_paths:
        recentPaths = msg.data
        renderRecentPathsDropdown()     // 重渲染下拉（本端也被 broadcast 覆盖，无需本地先删）
        addFrontendLog(同步日志, 'in')
```

## Server 改动（server.js）

1. 新增 `removeRecentPath(raw)`：
   ```js
   function removeRecentPath(raw) {
       const p = (raw || '').trim();
       if (!p) return;
       const before = config.recentPaths.length;
       config.recentPaths = config.recentPaths.filter(x => x !== p);
       if (config.recentPaths.length === before) return; // 本就不在列表，无变化
       saveConfig(config);
       broadcast({ type: 'recent_paths', data: config.recentPaths, deleted: p });
   }
   ```
   与现有 `addRecentPath` 同款结构（去重/置顶/截断 ↔ 过滤），保持风格一致。

2. 在 `ws.on('message')` 路由中新增分支：
   ```js
   else if (type === 'recent_paths_delete') removeRecentPath(data);
   ```
   （`data` 即要删除的 path 字符串。）

3. `recent_paths` 下行消息现已支持 `added` / `deleted` 两个可选字段，前端据此区分日志文案。

## 前端改动（public/index.html）

1. `renderRecentPathsDropdown()`：每条路径行改为「路径文本 + `✕` 按钮」布局。
   - 行容器 `click` → `copyToClipboard(p)` + `showToast('已复制','success')` + 关闭下拉（保持现有）。
   - `✕` 按钮 `click` → `e.stopPropagation()`（避免触发复制）+ `wsSend({ type: 'recent_paths_delete', data: p })`。
   - `✕` 用 `createElement` + `textContent = '✕'` 创建，路径文本仍用 `textContent` 防注入。

2. `ws.onmessage` 的 `recent_paths` 分支日志文案区分三种情况（沿用现有分支，扩展判断）：
   - `msg.added`   → `'最近路径已添加: ' + msg.added + ' (共 ' + recentPaths.length + ' 条)'`
   - `msg.deleted` → `'最近路径已删除: ' + msg.deleted + ' (共 ' + recentPaths.length + ' 条)'`
   - 否则          → `'最近路径已同步: ' + recentPaths.length + ' 条'`
   均调用 `addFrontendLog(..., 'in')`。

3. CSS：为 `✕` 按钮加最小样式（行内靠右、点击区域足够、`:hover` 反馈），复用现有 `.recent-path-item` 紧凑风格，不引入多余留白。

## 错误处理

- 删除不存在的 path：`filter` 无副作用，`removeRecentPath` 在长度无变化时直接 return，不写盘不广播，无副作用。
- 空 path / 非法输入：`if (!p) return` 兜底。
- 删除后本端重渲染依赖 server 的 broadcast（含自己），不依赖前端本地先删，避免两端状态分叉。

## 测试 / 验收

1. 安卓真机：点某条路径的 `✕` → 该项立即从下拉消失，`showToast('已删除')` 出现，设置→日志出现「最近路径已删除: xxx (共 N 条)」。
2. 多端同步：另一浏览器/终端打开 → 同步看到该项已消失、日志有对应「已删除」记录。
3. 持久化：重启 server → 删除结果仍在（`config.json` 已落盘）。
4. 边界：删除不存在的路径、空列表下删除 —— 均不应报错或产生错误日志。
5. 回归：点路径行其余位置仍正常复制；新增路径/同步逻辑不受影响。

## 不在本次范围（YAGNI）

- 不新增「清空全部」按钮（用户只要求单条删除）。
- 不引入删除二次确认弹窗（用户明确不需要）。
- 不把路径列表搬到设置面板（保持下拉弹窗的轻量交互）。
