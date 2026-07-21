# 实现计划：ntfy 安卓推送（最小可用版）

来源 spec：docs/superpowers/specs/2026-07-22-ntfy-phone-push.md
日期：2026-07-22

## Task 1 — 后端 server.js
- [ ] `loadConfig()` 默认块加 `ntfyEnabled: false, ntfyTopic: ''`
- [ ] 兜底段加 `if (typeof cfg.ntfyEnabled !== 'boolean') cfg.ntfyEnabled = false;` 与 topic 字符串校验
- [ ] 连接广播加 `ntfy_enabled` / `ntfy_topic`
- [ ] `ws.on('message')` 加 `ntfy_enabled`（boolean）、`ntfy_topic`（string）分支，broadcast + saveConfig
- [ ] BEL 定时器回调广播 bell 之后加 ntfy fetch POST（fire-and-forget，带 Title/Tag 头）

## Task 2 — 前端 public/index.html
- [ ] 状态变量 `ntfyEnabled` / `ntfyTopic`
- [ ] 设置弹窗通知分组加 ntfy 行（checkbox 即时 + 话题输入框 + 应用按钮 + hint）
- [ ] 回填两个控件
- [ ] `applySettingsNtfyEnabled()` / `applySettingsNtfyTopic()`
- [ ] WS handler 同步 `ntfy_enabled` / `ntfy_topic` + frontend log

## Task 3 — 文档 + 提交
- [ ] AGENTS.md 第41条 BEL 通道新增 ntfy 子项（协议/配置字段）
- [ ] 功能改动单独 commit；AGENTS.md 单独 commit
- [ ] 不擅自重启服务器，告知用户 `npm run restart`

## 验证
- 安卓 ntfy App 订阅随机话题 → 设置开推送并填话题 → 终端 `echo $([char]7)` → 手机收通知
