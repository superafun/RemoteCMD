# 设计文档：删除 RemoteCMD 终端自带通知子系统

日期：2026-07-22

## 背景与动机

用户已通过 CodeBuddy hooks（`pythonProjectFeiShuHooks` / `feishu_notify.py`）启用了终端通知，
因此 RemoteCMD 自身内置的通知功能已冗余。用户要求**删干净**这些内置通知功能，但**留好记录**，
以便日后后悔时能方便恢复。

本次删除的内置通知功能包括四类：

1. **通知声音**（Web Audio API 蜂鸣）—— `bellSoundEnabled` + `playBeep()`
2. **通知 Toast**（`bell` 触发的终端通知 Toast）—— `bellToastEnabled` + `showBellToast()`
3. **系统通知**（浏览器 Notification → OS 弹窗）—— `bellOsEnabled` + `fireOsNotification()`
4. **飞书自建应用推送**（完成标记命中后服务端调飞书 API 发消息）—— `feishuAppId/Secret/ReceiveId/ReceiveType` + `sendFeishuMessage()`

以及它们的唯一触发器：**完成标记检测**（`doneToken` / `REMOTECMD_DONE` → `broadcast({type:'bell'})`）。

## 恢复机制（"留好记录"的实现）

关键约束：`config.json` 被 `.gitignore` 排除，未纳入版本控制，里面含真实飞书凭证，
`git revert` 无法恢复它。因此采用双层恢复：

- **代码 / 文档 / 测试**：全部改动集中到**单个 git 提交**，`git revert <hash>` 即可完整还原。
- **配置（`config.json`）**：删除前先 `cp config.json config.json.bak` 生成**本地备份**
  （`.bak` 被 gitignore，不进版本库，作为本地安全网）。恢复时 `cp config.json.bak config.json`。
- **恢复文档**：新增 `docs/superpowers/RECOVERY-remove-notifications.md`，列出删除的符号/文件
  与精确还原命令。

## 删除清单（精确）

### 1. `server.js`

| 位置 | 内容 |
|------|------|
| 默认值块（约 L26–35） | 删除 `doneToken`、`bellSoundEnabled`、`bellToastEnabled`、`bellOsEnabled`、`bellBeepDurationMs`、`feishuAppId`、`feishuAppSecret`、`feishuReceiveId`、`feishuReceiveType` 默认值 |
| 兜底校验段（约 L72–81） | 删除 `doneToken` / `bell*` / `feishu*` 的 `typeof` 校验 |
| L175–211 | 整段删除飞书后端：`_feishuToken`/`_feishuTokenExpire` 缓存、`getFeishuToken()`、`sendFeishuMessage()` |
| `onData` 回调（约 L352–373） | 删除 `if (tok) {…}` 完成标记扫描块（含 `broadcast({type:'bell'})` 与飞书推送），**保留** `broadcast({type:'data',…})` 透传 |
| 连接下发（L419–428） | 删除 `done_token` / `bell_sound_enabled` / `bell_toast_enabled` / `bell_os_enabled` / `feishu_*` / `bell_beep_duration_ms` 下发 |
| ws 消息处理（约 L580–635） | 删除 `done_token` / `bell_sound_enabled` / `bell_toast_enabled` / `bell_os_enabled` / `feishu_app_id` / `feishu_app_secret` / `feishu_receive_id` / `feishu_receive_type` / `bell_beep_duration_ms` 分支 |

### 2. `public/index.html`

| 位置 | 内容 |
|------|------|
| L82–91 | 删除状态变量 `bellSoundEnabled`/`bellToastEnabled`/`bellOsEnabled`/`feishu*`/`bellBeepDurationMs` |
| L281–335 | 删除设置弹窗内"通知声音 / 通知 Toast / 系统通知 / 蜂鸣时长 / 飞书通知"分组 |
| L369–378 | 删除对应设置回填 |
| L420–468 | 删除函数 `showBellToast()`、`fireOsNotification()`、`playBeep()` |
| L588–637 | 删除对应 `applySettings*` 函数 |
| ws 消息处理区（约 L862–934） | 删除 `bell` / `bell_sound_enabled` / `bell_toast_enabled` / `bell_os_enabled` / `feishu_*` / `bell_beep_duration_ms` / `done_token` 处理分支 |

**保留**：通用 `showToast()`（复制成功/失败、删除、报错反馈）及其样式，与通知无关，不动。

### 3. `tests/`

删除 `feishu-settings-smoke.mjs`、`os-notify-smoke.mjs`（测的正是要删的功能）。

### 4. `config.json`

- 先 `cp config.json config.json.bak`
- 删除键：`doneToken`、`bellSoundEnabled`、`bellToastEnabled`、`bellBeepDurationMs`、`bellOsEnabled`、`feishuAppId`、`feishuAppSecret`、`feishuReceiveId`、`feishuReceiveType`
- 其余字段原样保留

### 5. `AGENTS.md`

精简通知相关文档：
- L46 配置表去掉 `feishuAppId/Secret/ReceiveId/ReceiveType` 飞书推送说明
- L68–95 WS 协议表去掉 `feishu_*` 行
- L311–349 BEL / `doneToken` 协议段改为一句："通知子系统（BEL/Toast/系统通知/飞书推送/doneToken 触发）已于 2026-07-22 移除，恢复见 `docs/superpowers/RECOVERY-remove-notifications.md`"
- 按 AGENTS.md 规矩，改完通知用户

### 6. 新增 `docs/superpowers/RECOVERY-remove-notifications.md`

记录：
- 删除了哪些文件 / 符号（Above 清单摘要）
- 还原步骤：`git revert <commit-hash>`（代码）；`cp config.json.bak config.json`（配置）
- 提示 `config.json` 不在 git，必须靠 `.bak` 恢复

## 明确不动的东西

- CodeBuddy hooks 飞书通知（用户新启用，位于 `.codebuddy/` 与 `pythonProjectFeiShuHooks`）
- 通用 `showToast`（复制/删除/报错反馈）
- ntfy：代码中早已移除，仅历史 spec/plan 文档提及，本次不处理
- 其他业务功能（会话、滚屏、输入栏、热键等）

## 生效与验证

- 改动集中在单 git 提交；`config.json.bak` 不提交（gitignored）。
- 改了 `server.js`，**需用户手动 `npm run restart` 生效**（AI 不自行重启）。
- 验证（用户重启后）：设置弹窗不再有声音/Toast/系统通知/飞书分组；终端输出 `REMOTECMD_DONE` 不再触发任何通知；无 JS 报错。
