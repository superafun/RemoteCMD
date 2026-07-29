# RemoteCMD GitHub 发布 & README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 RemoteCMD 项目以 `superafun/RemoteCMD`（Public, MIT）发布到 GitHub，并附一份中英双语、好看易读的 README。

**Architecture:** 纯内容/发布任务——不改动应用代码。新增 README/LICENSE/截图/config 模板，清理噪声文件，最后用 `gh` 创建并推送仓库。

**Tech Stack:** Git, GitHub CLI (`gh`), Markdown, Node.js 项目（仅元数据更新）

## Global Constraints

- Repo: `superafun/RemoteCMD`，**Public**，协议 **MIT**
- README 语言：**中英双语**（中文为主，英文段落在后）
- `config.json` 必须始终被 `.gitignore` 覆盖，**绝不**提交凭证（sessionSecret / feishuAppId / feishuAppSecret / htpasswdPath 真实路径）
- 截图来源：`D:\Downloads\windows截图.png` 与 `D:\Downloads\安卓手机截图.jpg`（用户真实截图）
- 提交信息用 Conventional Commits（中文描述亦可）
- 每个 task 末尾单独 commit

---

### Task 1: 清理噪声文件

**Files:**
- Delete: `falsen`, `truen`（仓库根目录，0 字节空文件）

**Interfaces:**
- 无依赖、无产出，仅清理工作区

- [ ] **Step 1: 删除空噪声文件**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
git rm -f falsen truen 2>/dev/null || rm -f falsen truen
ls falsen truen 2>&1 | head
```

Expected: `ls` 报错 "No such file" / 文件已不存在

- [ ] **Step 2: 提交清理**

```bash
git add -A
git commit -m "chore: remove stray empty files falsen/truen"
```

---

### Task 2: 复制真实截图到仓库

**Files:**
- Create: `docs/screenshots/windows.png`（来自 `D:\Downloads\windows截图.png`）
- Create: `docs/screenshots/android.jpg`（来自 `D:\Downloads\安卓手机截图.jpg`）

**Interfaces:**
- 产出：README 截图区引用的相对路径

- [ ] **Step 1: 创建目录并复制截图**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
mkdir -p docs/screenshots
cp "/d/Downloads/windows截图.png" docs/screenshots/windows.png
cp "/d/Downloads/安卓手机截图.jpg" docs/screenshots/android.jpg
ls -la docs/screenshots
```

Expected: 两个文件存在且大小 > 0

- [ ] **Step 2: 提交截图**

```bash
git add docs/screenshots
git commit -m "docs: add Windows & Android screenshots"
```

---

### Task 3: 创建 MIT LICENSE

**Files:**
- Create: `LICENSE`

**Interfaces:**
- 产出：GitHub 自动识别的开源协议文件

- [ ] **Step 1: 写入 MIT LICENSE（年份 2026，作者 superafun）**

```
MIT License

Copyright (c) 2026 superafun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: 提交 LICENSE**

```bash
git add LICENSE
git commit -m "docs: add MIT LICENSE"
```

---

### Task 4: 创建脱敏 config.example.json

**Files:**
- Create: `config.example.json`

**Interfaces:**
- 产出：用户复制为 `config.json` 的模板（敏感字段留空/占位，路径用相对值）
- 注意：`config.json` 已被 gitignore，本文件名为 `config.example.json` 不会被忽略

- [ ] **Step 1: 写入脱敏模板（敏感字段留空，htpasswdPath 用相对占位）**

```json
{
  "rows": 34,
  "cols": 110,
  "hotkeys": {
    "/": "/",
    "Esc": "\u001b",
    "Tab": "\t",
    "Enter": "\r",
    "↑": "\u001b[A",
    "↓": "\u001b[B",
    "←": "\u001b[D",
    "→": "\u001b[C",
    "Ctrl+C": "\u0003",
    "刷新Path": "$env:Path = [Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine')) + ';' + [Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','User'))"
  },
  "scrollStep": 5,
  "scrollInterval": 20,
  "maxFrontendLogs": 30,
  "sizeSlots": {
    "large": { "rows": 50, "cols": 182 },
    "small": { "rows": 40, "cols": 110 }
  },
  "currentSize": "small",
  "scrollIntervalTerminal": 40,
  "scrollIntervalPage": 20,
  "swipeThreshold": 12,
  "swipeClassify": 10,
  "showScrollButtons": false,
  "doneToken": "",
  "bellSoundEnabled": true,
  "bellToastEnabled": true,
  "bellBeepDurationMs": 800,
  "inputBarButtonAction": "newline",
  "inputBarEnterAction": "send",
  "inputBarCloseAfterSend": false,
  "enterDelayMs": 600,
  "inputBarHideOnBlur": false,
  "recentPaths": [],
  "screenHistoryLines": 500,
  "bellOsEnabled": true,
  "feishuAppId": "",
  "feishuAppSecret": "",
  "feishuReceiveId": "",
  "feishuReceiveType": "chat_id",
  "sessionDurationHours": 24,
  "htpasswdPath": "./htpasswd",
  "sessionSecret": "",
  "recentPathsLimit": 10
}
```

> 说明：`sessionSecret` 留空时服务端首次启动自动生成；`feishuAppId/Secret/ReceiveId` 不配置则飞书通知功能关闭；`htpasswdPath` 改为你的真实路径（支持 nginx htpasswd 格式）。

- [ ] **Step 2: 提交模板**

```bash
git add config.example.json
git commit -m "docs: add sanitized config.example.json template"
```

---

### Task 5: 撰写中英双语 README.md

**Files:**
- Create: `README.md`

**Interfaces:**
- 引用：`docs/screenshots/windows.png`、`docs/screenshots/android.jpg`
- 引用：`./LICENSE`、`./config.example.json`

- [ ] **Step 1: 写入完整 README（见下方内容块）**

```markdown
# RemoteCMD

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)
[![xterm.js](https://img.shields.io/badge/xterm.js-v6.x-orange.svg)](https://xtermjs.org/)
[![platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#)

> 🌐 **用浏览器远程操控 Windows PowerShell 终端** —— 手机、平板、任意设备，
> 随时操作你的 agent CLI / TUI。

**RemoteCMD** 是一个基于 Web 的远程 PowerShell 终端。无需安装客户端、无需 SSH/VPN，
打开浏览器即可获得完整的 PowerShell 会话，并针对移动端做了深度优化。

---

## ✨ 功能亮点

| 🌐 零安装 | 📱 移动端优化 | 🔌 多会话 | ⌨️ 自定义快捷键 |
|----------|--------------|----------|----------------|
| 打开浏览器即用，无需客户端 | 软键盘快捷键栏 + e.code 匹配 + 底部固定 | 同时管理多个会话，一键切换 | 为常用命令绑定快捷键 |
| 🔄 断线重连 | 🔐 登录鉴权 | 📐 双尺寸槽 | 🛠️ 一键部署 |
| 整屏 ANSI 序列化同步 | 签名 cookie + htpasswd 验证 | 大/小尺寸快速切换 | PM2 守护 + nginx 反代 |

- **🌐 纯网页零安装**：任何支持浏览器的设备都能用，不依赖 SSH/VPN。
- **📱 移动端深度优化**：软键盘上方自定义快捷键栏（Esc/Tab/方向键/Ctrl+C/刷新Path 等），
  通过 `e.code` 精确匹配按键，输入框底部固定，手机上也能流畅操作 agent CLI 与 TUI 程序
  （如 vim、htop、交互式安装器等）。
- **🔌 多会话切换**：同时维护多个 PowerShell 会话，工具栏一键切换，互不干扰。
- **⌨️ 自定义快捷键**：在设置中为常用命令或转义序列绑定名称，移动端一键发送。
- **🔄 断线自动重连**：重连时服务端以整屏 ANSI 序列化推回（含可见视口 + 有界滚动历史），
  不再有 tail 比对导致的画面缺失。
- **🔐 登录鉴权**：无状态签名 cookie（`rc_session`）+ 复用 nginx htpasswd 密码文件，
  可设"保持登录时长"，多端同步。
- **📐 大/小双尺寸槽**：预设两组终端尺寸，适配桌面大屏与手机窄屏，一键切换。
- **🛠️ PM2 守护 + nginx 部署**：`npm start` 即由 PM2 守护进程，`nginx` 反代并终结 TLS。

---

## 📸 截图

<p align="center">
  <img src="docs/screenshots/windows.png" width="49%" alt="Windows 桌面浏览器" />
  <img src="docs/screenshots/android.jpg" width="49%" alt="Android 手机" />
</p>

<p align="center">同一套界面，桌面与手机一致的远程终端体验。</p>

---

## 🚀 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/superafun/RemoteCMD.git
cd RemoteCMD

# 2. 安装依赖（node-pty 需要原生构建工具：Visual Studio Build Tools）
npm install

# 3. 生成配置文件
cp config.example.json config.json
#   编辑 config.json，至少设置 htpasswdPath 指向你的密码文件（见下方"配置"）

# 4. 安装并启动（PM2 守护，默认 http://localhost:<端口>）
npm install -g pm2
npm start
```

浏览器打开 `http://localhost:<端口>`，用 htpasswd 中的账号密码登录即可。

> 💡 没有 htpasswd 文件？用 nginx 自带工具生成：`htpasswd -c ./htpasswd 你的用户名`

---

## ⚙️ 配置（config.json）

复制 `config.example.json` 为 `config.json` 后按需修改。常用字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `rows` / `cols` | number | 34 / 110 | 终端初始行列 |
| `hotkeys` | object | `{}` | 快捷键名 → 转义序列/命令 |
| `sizeSlots` | object | 见模板 | 大/小尺寸槽（rows/cols） |
| `currentSize` | string | `"small"` | 当前尺寸 `large`/`small` |
| `scrollIntervalTerminal` | number | 40 | 终端按住滚动间隔(ms) |
| `scrollIntervalPage` | number | 20 | 页面按住滚动间隔(ms) |
| `screenHistoryLines` | number | 500 | 重连滚屏历史行数 |
| `recentPathsLimit` | number | 10 | 最近路径保存条数(1–100) |
| `maxFrontendLogs` | number | 30 | 前端日志上限(条) |
| `sessionDurationHours` | number | 24 | 保持登录时长(小时) |
| `sessionSecret` | string | 自动生成 | Cookie 签名密钥，**勿提交** |
| `htpasswdPath` | string | `./htpasswd` | 密码文件路径（nginx htpasswd 格式） |
| `feishuAppId` 等 | string | `""` | 飞书通知配置，留空则关闭 |

> ⚠️ `config.json` 已在 `.gitignore` 中，**不会被提交**。请勿把含 `sessionSecret` /
> 飞书凭证的真实 `config.json` 推送到公开仓库。

---

## 🖥️ 部署参考（nginx 反代 + TLS）

`server.js` 直接托管 `public/` 并监听 WebSocket（默认 `:<端口>`）。生产环境建议用 nginx 反代：

```nginx
server {
    listen 443 ssl;
    server_name your.domain;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location /cmd/ {
        proxy_pass http://127.0.0.1:<端口>/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Prefix /cmd/;
    }
}
```

- TLS 由 nginx 终结；RemoteCMD 自带登录页，nginx 块无需再加 `auth_basic`。
- 前端全用相对 URL，配合 `X-Forwarded-Prefix` 在子路径下正常工作。

---

## 🔒 安全说明

- `config.json`（含 `sessionSecret` 与飞书凭证）已被 `.gitignore` 排除，不会进入版本库。
- 登录 cookie 为 `HttpOnly` + `SameSite=Lax` + HTTPS 下自动 `Secure`。
- 密码复用 nginx htpasswd（`{SHA}` / `{PLAIN}` / 明文 / `$apr1$` 均支持）。
- 生产环境务必使用 HTTPS + 强密码。

---

## 📄 License

[MIT](LICENSE) © 2026 superafun

---

# English

## RemoteCMD

> 🌐 **Control a Windows PowerShell terminal from your browser** — phone, tablet,
> or any device, to operate your agent CLI / TUI anytime, anywhere.

RemoteCMD is a web-based remote PowerShell terminal. No client to install, no SSH/VPN —
just open a browser and get a full PowerShell session, with deep mobile optimizations.

### Features
- **🌐 Zero-install, web-only** — any browser-capable device works; no SSH/VPN.
- **📱 Mobile-optimized** — on-screen shortcut bar (Esc/Tab/arrows/Ctrl+C/refresh Path),
  `e.code`-based key matching, bottom-pinned input; smooth agent CLI & TUI on phones.
- **🔌 Multi-session** — manage several PowerShell sessions, switch with one tap.
- **⌨️ Custom hotkeys** — bind names to commands/escape sequences, send them in one tap.
- **🔄 Auto-reconnect** — full-screen ANSI serialization sync on reconnect (viewport + bounded scrollback).
- **🔐 Auth** — stateless signed cookie (`rc_session`) reusing your nginx htpasswd, with configurable session duration.
- **📐 Size slots** — preset large/small terminal sizes, one-click switch.
- **🛠️ Deploy** — `npm start` runs under PM2; nginx reverse-proxy + TLS reference included.

### Quick Start
```bash
git clone https://github.com/superafun/RemoteCMD.git
cd RemoteCMD
npm install
cp config.example.json config.json   # edit htpasswdPath
npm install -g pm2 && npm start
```
Open `http://localhost:<端口>` and log in with your htpasswd credentials.

### License
[MIT](LICENSE) © 2026 superafun
```

- [ ] **Step 2: 提交 README**

```bash
git add README.md
git commit -m "docs: add bilingual README with screenshots and deploy guide"
```

---

### Task 6: 更新 package.json 元数据

**Files:**
- Modify: `package.json`

**Interfaces:**
- 产出：GitHub 仓库页显示的标题/描述/协议/关键词

- [ ] **Step 1: 替换为以下 package.json 内容**

```json
{
  "name": "remotecmd",
  "version": "1.0.0",
  "description": "Web-based remote PowerShell terminal — control Windows shell from any browser, mobile-optimized for agent CLI/TUI.",
  "main": "server.js",
  "scripts": {
    "start": "cmd /c \"set NPM_CONFIG_ALLOW_SCRIPTS=&& pm2 start server.js --name remote-cmd\"",
    "restart": "pm2 restart remote-cmd",
    "stop": "pm2 stop remote-cmd",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [
    "terminal",
    "powershell",
    "web-terminal",
    "remote-shell",
    "xterm",
    "websocket",
    "node-pty",
    "cli",
    "tui",
    "mobile"
  ],
  "author": "superafun",
  "license": "MIT",
  "type": "commonjs",
  "dependencies": {
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-serialize": "0.15.0-beta.290",
    "@xterm/addon-unicode11": "^0.9.0",
    "@xterm/addon-web-links": "^0.12.0",
    "@xterm/headless": "6.1.0-beta.290",
    "@xterm/xterm": "6.1.0-beta.290",
    "express": "^5.2.1",
    "express-rate-limit": "^8.6.1",
    "node-pty": "^1.1.0",
    "ws": "^8.21.0"
  },
  "allowScripts": {
    "node-pty@1.1.0": true
  }
}
```

- [ ] **Step 2: 校验 JSON 合法**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
```

Expected: `package.json OK`

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "chore: update package.json metadata (name/description/license/keywords)"
```

---

### Task 7: 确认 .gitignore 覆盖充分

**Files:**
- Read: `.gitignore`
- Modify（如需）: `.gitignore`

**Interfaces:**
- 确保推送时不会带上任何凭证或噪声

- [ ] **Step 1: 校验敏感/噪声文件不被跟踪**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
echo "--- config.json 应被忽略 ---"; git check-ignore -v config.json
echo "--- 确认未被 git 跟踪 ---"; git ls-files | grep -E "config.json$|config.json.bak$|\.bak$" || echo "OK: 无敏感文件被跟踪"
echo "--- 待提交文件预览 ---"; git add -A -n
```

Expected: `config.json` 显示被 `.gitignore` 忽略；`git ls-files` 不含 `config.json`；`git add -A -n` 预览里**没有** `config.json` / `config.json.bak` / `falsen` / `truen`。

- [ ] **Step 2: 若发现遗漏则补充 .gitignore 并补提交**

仅在 Step 1 发现遗漏时执行：
```bash
printf '\n# === 敏感配置（含凭证，绝不提交）===\nconfig.json\nconfig.json.bak\n' >> .gitignore
git add .gitignore
git commit -m "chore: ensure config.json excluded from tracking"
```

---

### Task 8: 创建 GitHub 仓库并推送

**Files:**
- 远程：创建 `superafun/RemoteCMD`（Public, MIT）

**Interfaces:**
- 依赖：Task 1–7 全部完成并已提交

- [ ] **Step 1: 用 gh 创建公开仓库并推送当前分支**

```bash
cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
gh repo create superafun/RemoteCMD --public --source=. --push --description "Web-based remote PowerShell terminal — control Windows shell from any browser, mobile-optimized for agent CLI/TUI." --license MIT
```

Expected: 命令输出仓库 URL `https://github.com/superafun/RemoteCMD`，并提示 pushed to main。

- [ ] **Step 2: 验证远程与文件**

```bash
git remote -v
gh repo view superafun/RemoteCMD --json name,url,isPrivate,licenseInfo
```

Expected: `isPrivate` = false，`licenseInfo` 含 MIT，`url` 正确。

- [ ] **Step 3: 在 GitHub 页面确认 README 渲染与截图可见**

打开 `https://github.com/superafun/RemoteCMD`，确认：
- README 顶部徽章正常
- 两张截图并排显示
- 配置表 / 部署参考 / 英文段完整

（此步为人工核对，无需命令。）

---

## 自检（Spec Coverage）

- [x] Repo `superafun/RemoteCMD` / Public / MIT → Task 8
- [x] README 中英双语、Hero/功能网格/截图/Quick Start/配置/部署/安全/英文段 → Task 5
- [x] LICENSE(MIT) → Task 3
- [x] 截图来自用户真实文件 → Task 2
- [x] config.example.json 脱敏模板 → Task 4
- [x] 清理 falsen/truen → Task 1
- [x] package.json 元数据 → Task 6
- [x] config.json 不泄露 → Task 7
- [x] 无占位符 / TBD
