# 完成标记触发通知（替换 BEL）

日期：2026-07-22
状态：已批准，实现中

## 背景
BEL(`\x07`) 作为"任务完成"触发源误报太多（TUI/程序常自发响铃）。用户选定**显式完成标记**方案：在命令脚本末尾主动打印一个可配置标记串（默认 `REMOTECMD_DONE`），后端在 PTY 输出流里精确匹配该标记才触发通知，零误报。

## 设计原则
- **复用现有通知管道**：保留 `broadcast({type:'bell', id})` → 前端 Toast + 蜂鸣 + OS 弹窗 + ntfy 推送全链路。只换**触发源**，不碰通知渠道。
- **移除 BEL 触发**：不再扫描 `\x07`、不再依赖"输出静止 N ms"去抖（该语义正是误报根因）。`bellDebounceMs`/`bellArmed`/`bellTimer` 随之废弃删除。
- **精确匹配 + 跨 chunk 拼接**：标记可能跨 WebSocket chunk 分段到达，用 per-session `doneCarry` 缓冲尾部，匹配后只消费到标记处、保留其后未读内容。
- **可配置 + 多端同步**：标记串走 `config.json` + WS，沿用 `bellOsEnabled` 同款处理方式。
- **命中即触发（无去抖）**：标记是显式信号，匹配到立刻广播，最准确、最即时。
- **标记原样透传**：标记文本随 data 消息正常显示在终端（用户可见、可验证），不被滤除（遵循"不擅自过滤 PTY 输出"纪律）。

## 协议（新增，沿用现有风格）
- 后端→前端连接广播：`{ type:'done_token', data }`
- 前端→后端：`{ type:'done_token', data:string }`
- 后端收到后 `broadcast` 同步所有客户端 + `saveConfig`

## 配置字段（config.json）
- `doneToken`: string，默认 `'REMOTECMD_DONE'`；空串表示不触发

## 后端改动（server.js）
1. `loadConfig()` 默认块：`bellDebounceMs`/`bellSoundEnabled`/`bellToastEnabled`/`bellOsEnabled`/`bellBeepDurationMs` 保留（通知渠道）；删 `bellDebounceMs` 的"去抖"语义，新增 `doneToken: 'REMOTECMD_DONE'`
2. 兜底段：删 `bellDebounceMs` 校验；加 `if (typeof cfg.doneToken !== 'string') cfg.doneToken = 'REMOTECMD_DONE';`
3. session init：`doneCarry: ''`，删 `bellTimer: null, bellArmed: false`
4. `onData`：删 BEL 去抖块（含 \x07 检测 + timer）；改为 done-token 扫描：
   ```js
   const tok = config.doneToken || '';
   if (tok) {
       const buf = (sessions[newId].doneCarry || '') + d;
       const idx = buf.indexOf(tok);
       if (idx >= 0) {
           sessions[newId].doneCarry = buf.slice(idx + tok.length);
           broadcast({ type: 'bell', id: newId });
           if (config.ntfyEnabled && config.ntfyTopic) { /* 现有 ntfy fetch POST */ }
       } else {
           sessions[newId].doneCarry = buf.length > tok.length ? buf.slice(buf.length - tok.length) : buf;
       }
   }
   ```
5. `onExit`：删 `bellTimer` 清理
6. 连接广播：删 `bell_debounce_ms`；加 `done_token`
7. `ws.on('message')`：删 `bell_debounce_ms` 分支；加 `done_token` 分支（broadcast + saveConfig）

## 前端改动（public/index.html）
1. 状态变量 `let doneToken = 'REMOTECMD_DONE';`
2. 设置弹窗「通知」分组：删"通知防抖"输入框行；加
   - text input `settingsDoneTokenInput`（placeholder `REMOTECMD_DONE`）+ 应用按钮 `applySettingsDoneToken()`
   - 提示 span `hint-doneToken`
   - 一行说明文字：在脚本末尾 `Write-Host "REMOTECMD_DONE"` 触发
3. 回填 `settingsDoneTokenInput.value = doneToken;`
4. `applySettingsDoneToken()`：trim 后 `wsSend({type:'done_token', data:v})` + flashHint
5. WS handler：删 `bell_debounce_ms`；加 `done_token` 更新本地变量 + frontend log
6. 其余 `bell` 事件处理、sound/toast/os/ntfy 设置全部保留

## 验证步骤
1. 设置弹窗「通知」分组填完成标记（默认 `REMOTECMD_DONE`），点应用。
2. 终端执行 `Write-Host "REMOTECMD_DONE"`（或脚本末尾打印该串）。
3. 观察：立刻收到 Toast + 蜂鸣 + OS 弹窗；若开了 ntfy 推送，手机也收通知。
4. 误报验证：跑一个会自发响铃的 TUI（如 `cmd /c echo` 带 BEL 的程序），确认**不再**误触发。
5. 跨 chunk 验证：标记串被人为拆分到两次输出（如先 `Write-Host "REMOTECMD_` 再 `DONE"`），仍能正确匹配一次。

## 不做（本期范围外）
- 标记自动隐藏（保持可见，便于验证）
- 多标记 / 正则匹配
- 区分不同会话的不同标记（全局统一一份）
