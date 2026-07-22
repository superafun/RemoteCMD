# 实现计划：完成标记触发通知（替换 BEL）

来源 spec：docs/superpowers/specs/2026-07-22-done-token-trigger.md
日期：2026-07-22

## Task 1 — 后端 server.js
- [ ] 默认块：删 `bellDebounceMs`，加 `doneToken: 'REMOTECMD_DONE'`
- [ ] 兜底段：删 `bellDebounceMs` 校验，加 `if (typeof cfg.doneToken !== 'string') cfg.doneToken = 'REMOTECMD_DONE';`
- [ ] session init：删 `bellTimer/bellArmed`，加 `doneCarry: ''`
- [ ] `onData`：删 BEL 去抖块，改为 done-token 扫描 + 命中广播 bell（含 ntfy 出口）
- [ ] `onExit`：删 `bellTimer` 清理
- [ ] 连接广播：删 `bell_debounce_ms`，加 `done_token`
- [ ] `ws.on('message')`：删 `bell_debounce_ms` 分支，加 `done_token` 分支（broadcast + saveConfig）

## Task 2 — 前端 public/index.html
- [ ] 状态变量 `let doneToken = 'REMOTECMD_DONE';`
- [ ] 设置弹窗通知分组：删防抖输入框行，加完成标记输入行 + 说明
- [ ] 回填 `settingsDoneTokenInput.value`
- [ ] `applySettingsDoneToken()`
- [ ] WS handler：删 `bell_debounce_ms`，加 `done_token`

## Task 3 — 文档 + 提交
- [ ] AGENTS.md 第41条 BEL 通道说明改为"完成标记触发（doneToken）"，更新协议/配置字段
- [ ] 功能改动单独 commit；AGENTS.md 单独 commit
- [ ] 不擅自重启服务器，告知用户 `npm run restart`

## 验证
- 终端 `Write-Host "REMOTECMD_DONE"` → 立即 Toast+蜂鸣+OS 弹窗（+ntfy 手机）
- 自发响铃 TUI → 不再误触发
- 标记跨两次输出拆分 → 仍匹配一次
