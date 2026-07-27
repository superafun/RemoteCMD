# RemoteCMD 登录认证改造设计（nginx auth_basic → server.js）

日期：2026-07-27

## 背景与目标

当前 RemoteCMD 的访问保护完全依赖 nginx 的 `auth_basic`（基于 htpasswd 文件），
位于 `C:\Users\fmy3\OneDrive\project\pythonProjectiQuant2\nginx-1.28.2\conf\nginx.conf` 的
`/cmd/` 块。问题：不能控制“保持登录”的时长、未登录时不会自动跳登录页、时长设置无法在多端同步。

目标：
1. **去掉 nginx 的登录**，认证 authority 移入 `server.js`。
2. 新增**登录页**（由 `server.js` 提供）。
3. “保持登录时长”作为**普通设置项**：可配置、连接时下发、**多端同步**（与其它设置同款模式）。
4. **重连/连接时检查会话是否过期**，过期则跳登录页。

部署模型不变：nginx 仍作为 TLS 反代（`listen 65431` + `afun.natapp1.cc`），把 `/cmd/` 反代到
`127.0.0.1:65433` 并剥离 `/cmd/` 前缀；`X-Forwarded-Proto` / `X-Forwarded-Prefix /cmd` 保留。

## 已拍板的决策

- **密码源复用 nginx 的 htpasswd 文件**（不新建存储）。`server.js` 每次登录实时读取并校验。
- **无状态签名 cookie** 会话；不引入滑动/心跳续期——只在重连/连接时验 cookie，过期即拒。
- 默认登录时长 **1440 分钟（1 天）**。
- 顶栏**加「退出」按钮**。
- 登录页**不预填任何内容**（用户名、密码均空，仅 placeholder 提示），出于安全考虑。

## 认证模型

- Cookie 名：`rc_session`
- 值格式：`<到期时间戳ms>.<HMAC>`，其中 `HMAC = HMAC-SHA256(sessionSecret, 到期时间戳ms)`（base64）。
- 属性：`HttpOnly` + `SameSite=Lax` + `secure:'auto'`
  - 走 nginx HTTPS（`X-Forwarded-Proto: https`，需 `app.set('trust proxy', true)`）→ 自动加 `Secure`。
  - 直连 `http://localhost:65433` → 不加 `Secure`（本地 loopback 可接受）。
- `maxAge = sessionDurationMin * 60000`；cookie 自带 `maxAge` 与 token 内嵌的到期时间戳双重约束。
- 校验（每次 HTTP 请求 + 每次 WS 升级）：解析 cookie → 验 HMAC → 验 `到期时间戳 > Date.now()`，
  任一不满足即视为未登录。
- `sessionSecret`：存于 `config.json`（`sessionSecret` 字段），缺失时 `crypto.randomBytes(32).toString('hex')`
  自动生成并落盘。重启用同一密钥，不强制全员重登。

## 密码校验（复用 htpasswd，零新依赖）

- htpasswd 路径：常量默认值
  `C:\Users\fmy3\OneDrive\project\pythonProjectiQuant2\nginx-1.28.2\conf\htpasswd`，
  可用 `config.json.htpasswdPath` 覆盖。
- **每次登录实时 `fs.readFileSync` 读取**（改密码后无需重启 server.js）。
- 逐行解析 `用户名:哈希`；支持格式：
  - `{SHA}<base64>` → `crypto.createHash('sha1').update(pass).digest('base64') === 哈希`
    （当前文件即此格式：`fmy3@qq.com:{SHA}...`）。
  - `{PLAIN}...` 或无花括号 → 明文相等比较。
  - `$apr1$...` → Apache MD5（apr1）纯 JS 实现校验（仅作兼容，当前未用）。
  - 其它（如 bcrypt `$2y$`）→ 不支持，记 server_log 错误并返回校验失败。
- 登录表单提交 `username` + `password`，按用户名命中行校验。
- **不引入任何新 npm 依赖**（仅用 Node 内置 `crypto`）。

## 路由与端点（server.js）

中间件顺序：
1. `app.set('trust proxy', true)`
2. `app.use(express.json())`（解析 POST body）
3. 定义 cookie/token/htpasswd 辅助函数
4. 定义 `isAuthed(req)`
5. 登录相关路由（不经鉴权网关）：
   - `POST /api/login`：body `{username, password}` → 校验；成功种 cookie（`maxAge` 取自
     `sessionDurationMin`），302 到 `<prefix>/`（`prefix = req.headers['x-forwarded-prefix'] || ''`）；
     失败 401。
   - `POST /api/logout`：清 cookie（`maxAge=0`），200。
   - `GET /api/auth-check`：已登录 200，否则 401（供前端重连判定）。
6. **鉴权网关中间件**（挂在静态资源前）：
   - 放行白名单：`/login`、`/api/login`、`/api/logout`、`/api/auth-check`。
   - 已登录 → `next()`。
   - 未登录 → 若 `Accept` 含 `text/html` 则 302 到 `<prefix>/login`；否则 401。
7. `GET /login`：发 `public/login.html`；若已登录则 302 到 `<prefix>/`（跳回应用）。
8. 静态资源：`express.static(public)` + `/xterm` + `/addon-web-links` + `/addon-unicode11`（均在网关之后）。

## WebSocket 鉴权

- `new WebSocketServer({ server, verifyClient })`：`verifyClient(info, done)` 读 `info.req` 的 cookie，
  调 `isAuthed`；通过 `done(true)`，否则 `done(false, 401, 'Unauthorized')`。
- 升级被拒 → 浏览器 `ws.onerror/onclose` → 前端判定后跳 `/login`。
- 既有的 `wss.on('connection')` 逻辑不变；在连接建立下发列表里新增一条
  `ws.send({type:'session_duration_min', data: config.sessionDurationMin})`。

## 前端改动（public/index.html）

1. **重连过期跳转**：在 `ws.onclose` 现有重连逻辑前，先
   `fetch('api/auth-check')`（相对 URL）：
   - 返回 401 → `location.href = 'login'`（相对，自动适配 `/cmd/` 或 `/` 前缀），停止重连。
   - 网络错误 / 200 → 维持原重连退避逻辑（在线则 1s 后 `connect`，离线等 `online` 事件）。
2. **退出按钮**：顶栏「设置」旁新增「退出」按钮（与「设置」同款样式），点击
   `fetch('api/logout', {method:'POST'})` 成功后 `location.href = 'login'`。
3. **登录时长设置项**（多端同步，与 `swipe_threshold` / `enterDelayMs` 同款“应用按钮”模式）：
   - 设置弹窗新增一行「保持登录时长 (分钟)」：number input + 「应用」按钮。
   - `applySettingsSessionDuration()`：仅 `wsSend({type:'session_duration_min', data})`，**不本地改状态**
     （服务端权威）。
   - 接收侧 `session_duration_min` handler：更新全局变量 + 前端日志 `'保持登录时长同步为 X 分钟'`。
   - 服务端校验范围：**正整数 1–20160（14 天）**，越界拒收（不修改 config、不广播）。
   - `openSettingsModal()` 打开时回填当前值。
4. **URL 策略**：前端所有 fetch / 跳转一律用**相对 URL**（不写死 `/cmd/`），以兼容 nginx 前缀与直连两种访问。
   WS 连接路径维持现有 `/cmd/`（直连时 server.js 不按路径过滤升级，同样接受）。

> 注：`session_duration_min` 改变后影响的是**下次登录**的 cookie 有效期；已登录会话的 cookie 在登录时
> 已固定，要等下次重连/重登才按新值。这是无状态 cookie 的固有行为，符合“重连时检查是否过期”的诉求。

## 新增文件

- `public/login.html`：单文件、Stripe 风格居中卡片。含用户名 + 密码输入框（均空，仅 placeholder）、
  提交按钮、错误提示区。提交走 `fetch('api/login', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({username,password})})`；成功按 `location.pathname` 推导前缀跳回应用
  （`base = location.pathname.replace(/\/[^/]*$/,'')`，`location.href = base + '/'`），失败显示错误。
  同样使用相对 URL。

## config.json 改动（gitignore，不提交；改动前先 `cp config.json config.json.bak`）

- 新增 `sessionDurationMin`（默认 1440）。
- 新增 `sessionSecret`（缺失自动生成）。
- 新增 `htpasswdPath`（默认 nginx 路径；可选覆盖）。
- `loadConfig()` 兜底：非数字/越界 → 回退 1440；`htpasswdPath` 缺失 → 默认路径；`sessionSecret` 缺失 → 生成并落盘。

## nginx.conf 改动

`/cmd/` 块删除 3 行（注释 + `auth_basic` + `auth_basic_user_file`），其余（`proxy_pass`、`X-Forwarded-*`、
WebSocket Upgrade 头、`proxy_read_timeout` 等）原样保留。用户执行 `nginx -s reload`。

## 涉及的改动文件

| 文件 | 改动 |
|------|------|
| `server.js` | trust proxy、cookie/token/htpasswd 辅助、登录路由、鉴权网关、WS `verifyClient`、连接时下发 `session_duration_min`、WS handler `session_duration_min`、config 默认值 |
| `public/index.html` | 重连过期跳转、退出按钮、登录时长设置项（应用+接收+回填） |
| `public/login.html` | 新增登录页 |
| `nginx.conf` | 删除 `/cmd/` 块 3 行 auth_basic |
| `AGENTS.md` | 协议表新增 `session_duration_min`（双向）+ 登录端点说明 + 注意事项（认证 authority 归 server.js、cookie 模型、htpasswd 复用、重连检查、相对 URL 兼容前缀） |
| `config.json` | 本地加 `sessionDurationMin`/`sessionSecret`/`htpasswdPath`（不提交） |

## 性能影响分析

- **鉴权网关**：每次 HTTP 请求做 `cookie` 解析 + 一次 HMAC-SHA256 校验（微秒级），可忽略。静态资源
  （xterm JS/CSS 等数个文件）每个请求各验一次，开销可忽略。
- **WS `verifyClient`**：每次升级一次 HMAC 校验，可忽略。
- **htpasswd 读取**：仅在登录时 `readFileSync` 一个小文件 + 一次 sha1，非高频，可忽略。
- **前端**：仅新增 1 个退出按钮 DOM 节点 + 1 个点击 listener；重连时新增一次 `fetch('api/auth-check')`
  （仅断线时触发，非持续轮询）。无新增定时器、无持续轮询、无布局抖动。
- **无新 npm 依赖**，无原生构建。

## 安全说明（贴合单机自用部署模型）

- 会话为无状态签名 cookie，密钥仅本机持有；`HttpOnly` 防 JS 读取，`SameSite=Lax` 缓解 CSRF。
- 密码经 htpasswd 校验，原密码文件不被 server.js 修改/外发。
- 登录页不预填用户名/密码，避免本地窥屏泄露账号。
- 单用户场景下不引入多租户加固（与项目既定部署模型一致）。

## 验收标准

1. nginx 去掉 auth_basic 后，未登录访问 `https://afun.natapp1.cc/cmd/` → 自动跳到登录页。
2. 输入正确用户名/密码 → 进入终端；错误 → 登录页显示错误。
3. 等待超过 `sessionDurationMin` 分钟后触发一次重连（或刷新页面）→ 跳登录页要求重登。
4. 设置弹窗改「保持登录时长」并应用 → 多端同步；新登录按新值生效。
5. 点「退出」→ 清 cookie 并跳登录页。
6. 直连 `http://localhost:65433` 也能登录/鉴权（相对 URL 兼容）。
7. `config.json` 改动不破坏既有字段；`git status` 确认 config.json 不进提交。
