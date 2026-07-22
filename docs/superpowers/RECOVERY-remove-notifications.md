# 恢复指南：终端通知子系统（2026-07-22 移除）

本目录原内置四类通知（声音 / Toast / 系统通知 / 飞书推送）及其 doneToken 完成标记触发器，
于 2026-07-22 经一次提交整体删除（提交信息以 `refactor: 删除终端内置通知子系统` 开头，因用户已改用 CodeBuddy hooks 飞书通知）。

## 删除清单
- server.js：通知配置默认值、兜底校验、飞书后端（getFeishuTenantToken/sendFeishuMessage）、
  onData 内 doneToken 扫描 + bell 广播、连接下发、ws 消息处理分支。
- public/index.html：状态变量、设置 UI（通知/飞书分组）、函数（showBellToast/fireOsNotification/playBeep）、
  apply 函数、ws 处理分支。
- tests/：feishu-settings-smoke.mjs、os-notify-smoke.mjs。
- config.json：doneToken / bell* / feishu* 字段（保留其余）。
- AGENTS.md：精简通知文档。

## 恢复步骤
1. 代码：在仓库根执行以下命令，按提交信息定位该提交并整体还原（无需记忆哈希）：
   `git revert $(git log --grep "删除终端内置通知子系统" --format=%H -1)`
   即可完整还原 server.js / index.html / tests / AGENTS.md。
2. 配置：config.json 不在 git（被 .gitignore 排除），需从本地备份还原：
   `cp config.json.bak config.json`
   （config.json.bak 由删除时生成，含原飞书凭证；如已丢失，按原格式重新填写。）

## 注意
- 恢复代码后仍需 `npm run restart` 使 server.js 生效。
- 通用 showToast（复制/删除/报错反馈）未受影响，无需恢复。
