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

## 📸 截图

<p align="center">
  <img src="screenshots/windows.png" width="49%" alt="Windows 桌面浏览器" />
  <img src="screenshots/android.jpg" width="49%" alt="Android 手机" />
</p>

<p align="center">同一套界面，桌面与手机一致的远程终端体验。</p>

---

## 🎯 设计背后的故事

RemoteCMD 不是那种「把 SSH 套个 Web 壳就完事」的项目。每一处设计，背后都有一个真实的痛点。

### 为什么不走 SSH 网关？

绝大多数 Web 终端是 `Web → SSH网关 → 目标机器`。RemoteCMD 没走这条路——它直接在服务器上通过 `node-pty` 派生真实的 PowerShell 进程，通过 WebSocket 把 stdin/stdout 双向透传给浏览器。

核心理由只有一条：**让终端变成一个纯粹的网页应用，从而在任何设备上无缝运行。**

如果依赖 SSH 网关，客户端就必须装 SSH 客户端（或浏览器端 JS 实现的 SSH，慢且功能残缺）。这会把手机、平板、Chromebook——以及一切没有原生 SSH 客户端的设备——排除在外。而一个浏览器谁都有，不管你在 Windows、macOS、iOS、Android 还是 ChromeOS 上，打开同一个 URL，得到同一个终端。

`node-pty` 是关键：服务端派生真实的 PowerShell 子进程，WebSocket 把字节流双向透传。浏览器只是一个薄薄的渲染层，不关心底层是什么操作系统、什么 shell。没有 SSH 握手开销、没有网关瓶颈，每条命令的响应时间就是你按下回车到看到输出的真实时间。

### 断线重连：从 tail 追逐到画面冻结

早期版本的重连策略是「客户端缓存尾字节、服务端发差额」，类似 `tail -c+N`。这套方案在多终端写并发时出了问题：终端 A 输出一段、终端 B 输出一段、重连时只看某个字节偏移，拿到的数据可能跨越两条终端的内容，画面拼接后是乱的。

解决方式很彻底：**在服务端跑一个无头 xterm 实例**。服务端的 headless xterm 一直在后台渲染所有终端输出，维护着和客户端完全相同的画面状态。重连时，服务端把整屏画面序列化为 ANSI 转义序列，一次性推回——`term.reset()` + `term.write(ansi)`。不再斤斤计较字节差分，直接画面冻结、整帧传输。

### 手机是第一等公民，不是凑合能用

很多 Web 终端在手机上能用，但体验属于「能忍受」。RemoteCMD 的移动端优化是逐像素打磨的。

最大的坑是 Android Chrome 的键盘事件。物理键盘快捷键按下时，`e.key` 返回 `Unidentified`——如果你用 `e.key === 'c'` 去匹配 Ctrl+C，一定失效。修复是改用 `e.code`（不受键盘布局影响），配合 `ctrlKey`/`metaKey` 修饰键检测。

然后在软键盘上方，我们放了一排自定义快捷键按钮：Esc、Tab、方向键、Ctrl+C、刷新环境变量路径。为什么是这些？因为手机上没有真的键盘，每次切数字符号键盘去打 `Tab` 或 `↑` 都令人崩溃。一个专为手机设计的快捷键栏，让常用按键触手可及。

输入框固定在屏幕底部、软键盘上方——用 `interactive-widget: resizes-content` 让浏览器原生支持，而不是靠 JS 算 `visualViewport` 高度。滚屏则是触摸滑动手势（Swipe to Scroll），因为手机没有滚轮。

### 为什么是两个尺寸槽，而不是自动缩放？

自动缩放终端听起来美好，实际上很尴尬：你在一台 27 寸显示器上设了 80×40 的终端，换到手机时自动缩成 40×20——不是所有 TUI 程序都懂响应式布局。

所以我们做了两套固定尺寸槽：一套「大」给桌面（例如 50×182，充分利用宽屏），一套「小」给手机（例如 40×110，适配窄屏）。一键切换，服务端实时调整 PTY 尺寸。就这么简单，但也足够高效。

### 无状态登录：一枚 cookie 搞定一切

不依赖服务端 Session 存储（没有 Redis、没有内存表），登录态全靠签名 cookie `rc_session = 时间戳.HMAC-SHA256(secret, 时间戳)`。无状态 = 无内存泄露风险、无 Session 过期竞态、可水平扩展。`HttpOnly` + `SameSite=Lax` + HTTPS 下自动加 `Secure`，标准的 Web 安全三件套。

密码文件直接复用 nginx 的 htpasswd——不引入第二套密码体系。支持 `{SHA}` / `{PLAIN}` / `$apr1$` 格式。`sessionSecret` 由服务端首次启动时自动生成，**无需手动配置**。

### 快捷键：不是绑键盘事件，是发转义序列

浏览器键盘事件跨平台差异极大。我们没去踩这个坑——快捷键被命名为「Tab」「Ctrl+C」「↑」，映射为对应的转义字符（`\t`、`\x03`、`\x1b[A`），通过 WebSocket 逐字符发送到终端。

这意味着：
- 快捷键**不依赖任何键盘事件**——手机端也可以配置和使用
- 一个「发送命令」按钮可以绑定任意长度的命令字符串
- 移动端的快捷键栏按钮和桌面端实体键盘共享同一套映射

### 输入条的「回车停顿」是什么鬼？

当你一次性粘贴多行代码发送到终端时，每行末尾带一个 `\r`。如果这堆 `\r` 像暴雨一样砸向 PTY，子进程可能来不及消化就丢失部分输入。`enterDelayMs`（默认 300ms）在每次发送 `\r` 后微停一下，让 PTY 喘口气。这个值你可以从 50ms 调到 3000ms——越快越爽，越慢越稳。

### 跟踪最近路径：你到过哪里

终端里最频繁的操作就是 `cd`。我们自动捕获 `cd` / `chdir` 操作，把去过的地方记录下来。路径长到溢出时，采用**右对齐截断**——保留最右侧的区分段落，因为"项目名/分支名"在末尾，比前面的盘符和用户目录更重要。

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

# 4. 安装并启动（PM2 守护，端口由 config.json 的 `port` 字段决定）
npm install -g pm2
npm start
```

浏览器打开 `http://localhost:<端口>`（端口见 config.json 的 `port` 字段），用 htpasswd 中的账号密码登录即可。

> 💡 没有 htpasswd 文件？用 nginx 自带工具生成：`htpasswd -c ./htpasswd 你的用户名`

---

## ⚙️ 配置（config.json）

复制 `config.example.json` 为 `config.json` 后按需修改。常用字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 内置默认端口 | 监听端口（1–65535）；nginx 反代需与此一致 |
| `rows` / `cols` | number | 34 / 110 | 终端初始行列 |
| `hotkeys` | object | `{}` | 快捷键名 → 转义序列/命令 |
| `sizeSlots` | object | 见模板 | 大/小尺寸槽（rows/cols） |
| `currentSize` | string | `"small"` | 当前尺寸 `large` / `small` |
| `scrollIntervalTerminal` | number | 40 | 终端按住滚动间隔(ms) |
| `scrollIntervalPage` | number | 20 | 页面按住滚动间隔(ms) |
| `screenHistoryLines` | number | 500 | 重连滚屏历史行数 |
| `recentPathsLimit` | number | 10 | 最近路径保存条数(1–100) |
| `maxFrontendLogs` | number | 30 | 前端日志上限(条) |
| `sessionDurationHours` | number | 24 | 保持登录时长(小时) |
| `sessionSecret` | string | 服务端自动生成 | Cookie 签名密钥，**无需手动配置** |
| `htpasswdPath` | string | `./htpasswd` | 密码文件路径（nginx htpasswd 格式） |

> ⚠️ `config.json` 已在 `.gitignore` 中，**不会被提交**。请勿把含密码等敏感信息的 `config.json` 推送到公开仓库。

---

## 🖥️ 部署参考（nginx 反代 + TLS）

`server.js` 直接托管 `public/` 并监听 WebSocket（端口由 `config.json` 的 `port` 字段决定）。生产环境建议用 nginx 反代：

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

- `config.json`（本地运行配置）已被 `.gitignore` 排除，不会进入版本库。
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

### Design Philosophy

RemoteCMD isn't yet another "SSH in a web wrapper." Every feature was born from real-world pain.

**No SSH gateway.** Pure web from the start — `node-pty` spawns real PowerShell processes, WebSocket streams the bytes to the browser. No SSH client required on the client side. This means **any browser-capable device works**: phone, tablet, Chromebook, whatever — they all have a browser, they all open the same URL and get the same terminal.

**Reconnect that actually works.** Early versions used byte-offset diffing. It broke when multiple terminals interleaved output. The fix: a headless xterm running on the server, always in sync with the real display. Reconnect = freeze the frame → serialize as ANSI → push whole frame. No math, no mismatches.

**Mobile is a first-class citizen.** Android Chrome's `e.key` returns `Unidentified` for physical keyboard shortcuts, so we match by `e.code`. Soft keyboard gets a custom shortcut bar. Scroll by swipe, not by wheel. Input bar pinned above the keyboard via `interactive-widget: resizes-content` — zero JS overhead.

**Two size slots, not auto-resize.** Terminal programs don't do responsive design. A 27" monitor wants different dimensions than a 6" phone. Two presets (large / small), one tap to switch. The terminal stays crisp at every size.

**Stateless auth.** HMAC-signed cookies, no server-side sessions. No Redis, no memory leaks, no expiry races. Reuses your existing nginx htpasswd — one password file to rule them all.

**Hotkeys = escape sequences, not key events.** Browser keyboard handling is inconsistent. RemoteCMD maps named shortcuts to literal escape sequences and sends them character-by-character over WebSocket. Works identically on every browser — and on mobile, where there's no physical keyboard at all.

**Enter delay protects pastes.** Pasting many lines at once floods the PTY with `\r` characters. A configurable `enterDelayMs` inserts a tiny pause between lines — just enough to keep the terminal from choking, fast enough to feel instant.

**Recent paths track your breadcrumbs.** `cd` is the most frequent terminal command. RemoteCMD auto-captures it, builds a history, and right-aligns long paths so you see the important part: the project and branch at the end.

### Quick Start
```bash
git clone https://github.com/superafun/RemoteCMD.git
cd RemoteCMD
npm install
cp config.example.json config.json   # edit htpasswdPath
npm install -g pm2 && npm start
```
Open `http://localhost:<PORT>` and log in with your htpasswd credentials (port = `config.json` `port`).

### License
[MIT](LICENSE) © 2026 superafun
