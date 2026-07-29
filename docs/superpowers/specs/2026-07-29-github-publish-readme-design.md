# RemoteCMD GitHub 发布 & README 设计文档

**日期**: 2026-07-29
**状态**: 待用户审批
**决策**: Repo = `superafun/RemoteCMD`，Public，MIT License，中英双语 README

---

## 1. 发布范围

### 1.1 仓库创建
- `gh repo create superafun/RemoteCMD --public --source=. --push`
- 账号: `superafun`（已通过 gh CLI 登录）

### 1.2 新增文件
| 文件 | 用途 |
|------|------|
| `README.md` | 项目主页 + 使用指南（中英双语） |
| `LICENSE` | MIT 协议 |
| `docs/screenshots/windows.png` | Windows 浏览器截图（用户提供） |
| `docs/screenshots/android.jpg` | Android 手机截图（用户提供） |

### 1.3 清理/排除
| 文件 | 处理 | 原因 |
|------|------|------|
| `falsen`, `truen` | **删除** | 空文件，无意义噪声 |
| `docs/superpowers/task*-report.md` | **不提交** | subagent 报告，非项目代码 |
| `config.json` | 已 gitignore | 含 sessionSecret / 飞书凭证等敏感信息 |

---

## 2. README 设计

### 2.1 Hero 区域
```
# RemoteCMD
[徽章行] MIT · Node.js · WebSocket · xterm.js

> 用浏览器远程操控 Windows PowerShell 终端——手机、平板、任意设备，
> 随时操作你的 agent CLI / TUI。
```

**徽章 (shields.io)**：
- `license-MIT-blue`
- `node-v^20+-green`
- `xterm.js-v6.x-orange`
- `platform-windows-lightgrey`

### 2.2 功能亮点（卡片网格）
4 列 x 2 行，emoji + 标题 + 一句话：

| Emoji | 功能 | 说明 |
|-------|------|------|
| 🌐 | 纯网页零安装 | 打开浏览器即用，无需客户端、SSH 或 VPN |
| 📱 | 移动端优化 | 自定义快捷键栏 + e.code 键盘匹配 + 底部固定输入条 |
| 🔌 | 多会话切换 | 同时管理多个 PowerShell 会话，一键切换 |
| ⌨️ | 自定义快捷键 | 为常用命令绑定快捷键，提升操作效率 |
| 🔄 | 断线自动重连 | 整屏 ANSI 序列化同步，断线后无缝恢复 |
| 🔐 | 登录鉴权 | 签名 cookie + htpasswd 密码验证，可设保持时长 |
| 📐 | 双尺寸槽位 | 大/小终端尺寸快速切换，适配不同屏幕 |
| 🛠️ | PM2 守护部署 | 进程自动重启，nginx 反代 TLS 参考配置 |

### 2.3 截图区
两张并排展示：
- 左：Windows 桌面浏览器截图 → `docs/screenshots/windows.png`
- 右：Android 手机截图 → `docs/screenshots/android.jpg`

说明文字：「同一界面，跨设备一致体验。」

### 2.4 快速开始（Quick Start）
```bash
# 克隆
git clone https://github.com/superafun/RemoteCMD.git
cd RemoteCMD

# 安装依赖（需要 Visual Studio Build Tools 用于 node-pty）
npm install

# 创建配置文件（从模板复制）
cp config.example.json config.json

# 启动服务（PM2 守护，默认 http://localhost:65433）
npm start
```

> **注意**: 首次使用需在 `config.json` 中设置密码。详见下方「配置」章节。

### 2.5 配置表（config.json 字段表）
列出所有可配置项及默认值：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `rows` | number | 24 | 终端行数 |
| `cols` | number | 80 | 终端列数 |
| `hotkeys` | object | {} | 自定义快捷键映射 |
| `scrollIntervalTerminal` | number | 50 | 终端按住滚动间隔(ms) |
| `scrollIntervalPage` | number | 300 | 页面按住滚动间隔(ms) |
| `screenHistoryLines` | number | 1000 | 重连滚屏历史行数 |
| `recentPathsLimit` | number | 10 | 最近路径保存条数(1-100) |
| `maxFrontendLogs` | number | - | 前端日志上限 |
| `sessionDurationHours` | number | 24 | 保持登录时长(小时) |
| `sessionSecret` | string | auto-gen | Cookie 签名密钥 |
| `htpasswdPath` | string | nginx conf 下 | 密码文件路径 |

### 2.6 部署参考（Deployment）
简述 nginx 反代 + TLS 配置要点：
- `/cmd/` 前缀反代到 localhost:65433
- TLS 由 nginx 处理
- htpasswd 认证（可选，项目自带登录页）

### 2.7 安全说明
- `config.json` 已 gitignore，不会提交凭证
- sessionSecret 首次启动自动生成
- cookie HttpOnly + SameSite=Lax + Secure(HTTPS)
- 建议：生产环境走 HTTPS + 强密码

### 2.8 英文段落（English Section）
完整英文版 hero + features + quick start，放在中文内容之后。

### 2.9 底部
- License: MIT
- Author: superafun
- Links: Issues / Pull Requests

---

## 3. 实现步骤（待 writing-plans 展开）

1. 清理噪声文件（删除 falsen/truen）
2. 复制截图到 docs/screenshots/
3. 创建 LICENSE (MIT)
4. 创建 README.md（中英双语）
5. 创建 config.example.json（脱敏模板）
6. 更新 package.json（name/description/license/keywords）
7. 更新 .gitignore（确保覆盖充分）
8. git add + commit
9. gh repo create + push

---

## 4. 设计自检

- [x] 无 TBD / 占位符
- [x] 截图来源明确（用户提供真实截图）
- [x] 敏感信息处理明确（config.json gitignore + example 模板）
- [x] scope 单一（README + 发布，不含功能开发）
- [x] 歧义消除（repo 名/协议/语言/可见性均已确认）
