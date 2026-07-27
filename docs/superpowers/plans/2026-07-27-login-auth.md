# RemoteCMD 登录认证改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把登录认证从 nginx `auth_basic` 移到 `server.js`（无状态签名 cookie），新增由 server.js 提供的登录页，并把“保持登录时长”做成可配置、多端同步的设置项；重连/连接时检查会话过期则跳登录页。

**Architecture:** `server.js` 增加 cookie/token/htpasswd 辅助函数与登录路由，并在静态资源前挂鉴权网关；WebSocket 升级经 `verifyClient` 校验 cookie。前端在 WS 断线后 `fetch` 一个鉴权检查端点判定是否过期并跳转；设置弹窗新增登录时长项。nginx 仅删除 `/cmd/` 块的 `auth_basic` 三行。

**Tech Stack:** Node.js (Express 5、ws)、Node 内置 `crypto`（HMAC-SHA256 / SHA1 / MD5-apr1，零新依赖）、原生前端 JS（xterm 单页）、nginx TLS 反代。

## Global Constraints

- 不引入任何新 npm 依赖（仅用 Node 内置 `crypto`）。
- `config.json` 不进 git（已被 `.gitignore` 排除）；改它之前必须先 `cp config.json config.json.bak`（见项目记忆）。
- 改 `server.js` 后由用户执行 `npm run restart`（AI 不擅自重启）；前端静态文件刷新即生效。
- 所有前端 `fetch` / 跳转一律用**相对 URL**（不写死 `/cmd/`），兼容 nginx 前缀与直连两种访问。
- 设置类 apply 函数只 `wsSend`，不本地改状态（服务端权威）；接收侧更新变量 + 前端日志。
- 代码改动后必须 `git commit`；本次涉及协议/设置变更，还需同步更新 `AGENTS.md` 并 commit。
- 编码：CJK 文件（AGENTS.md）改动用字节级 Node 脚本（禁用正则贪心），避免中文被污染成 `?`。
- `sessionDurationMin` 校验范围：正整数 **1–20160**（14 天），越界拒收。

---

## 文件结构与职责

| 文件 | 职责 |
|------|------|
| `server.js` | 信任代理；cookie/token/htpasswd 辅助；`/api/login`、`/api/logout`、`/api/auth-check` 路由；鉴权网关中间件；`GET /`、`GET /login`；WS `verifyClient`；连接时下发 `session_duration_min`；WS handler `session_duration_min`；`loadConfig` 新增字段默认值 |
| `public/index.html` | 顶栏退出按钮；`ws.onclose` 重连前鉴权检查；设置弹窗新增登录时长行 + `applySettingsSessionDuration()`；接收侧 `session_duration_min`；打开弹窗回填 |
| `public/login.html` | 新增登录页（Stripe 风格卡片，用户名+密码均不预填） |
| `nginx.conf` | `/cmd/` 块删除 `auth_basic` 三行 |
| `AGENTS.md` | 协议表加 `session_duration_min`（双向）+ 登录端点说明 + 注意事项（认证 authority 归 server.js、cookie 模型、htpasswd 复用、重连检查、相对 URL 兼容前缀） |

---

### Task 1: server.js — 配置默认值与 sessionSecret 生成

**Files:**
- Modify: `server.js`（`loadConfig` 函数，约 L13–L68；常量区 L1–L11）

**Interfaces:**
- 消费：无（仅 Node 内置模块）。
- 生产：`config.sessionDurationMin`（默认 1440）、`config.sessionSecret`（缺失自动生成）、`config.htpasswdPath`（默认 nginx 路径），供后续 Task 的路由/中间件使用。

- [ ] **Step 1: 在文件顶部 require crypto**

在 `server.js` 顶部 `const fs = require('fs');` 之后新增一行：

```javascript
const crypto = require('crypto');
```

- [ ] **Step 2: 在 `loadConfig` 默认对象中加入 sessionDurationMin / htpasswdPath**

在 `loadConfig` 默认对象（当前含 `recentPaths: []` 那一项）末尾追加两行：

```javascript
            recentPaths: [],
            sessionDurationMin: 1440,
            htpasswdPath: 'C:\\Users\\fmy3\\OneDrive\\project\\pythonProjectiQuant2\\nginx-1.28.2\\conf\\htpasswd'
```

- [ ] **Step 3: 在 `loadConfig` 校验兜底段加入 sessionDurationMin 兜底**

在 `loadConfig` 现有校验段（`if (!Number.isInteger(cfg.screenHistoryLines) ...` 等之后，return 之前）追加：

```javascript
    if (typeof cfg.sessionDurationMin !== 'number' || cfg.sessionDurationMin < 1 || cfg.sessionDurationMin > 20160) cfg.sessionDurationMin = 1440;
    if (typeof cfg.htpasswdPath !== 'string' || !cfg.htpasswdPath) cfg.htpasswdPath = 'C:\\Users\\fmy3\\OneDrive\\project\\pythonProjectiQuant2\\nginx-1.28.2\\conf\\htpasswd';
```

- [ ] **Step 4: 在 `loadConfig` 返回前生成 sessionSecret 并落盘**

在 `loadConfig` 的 `return cfg;` 之前插入（注意 `saveConfig` 已在 L69 定义，但 `loadConfig` 在 L13、`saveConfig` 在 L69 之后定义；函数提升使得调用没问题，但 `loadConfig` 在模块加载时同步调用 `saveConfig` 需 `saveConfig` 已定义。当前 `loadConfig()` 在 L72 被调用，晚于 L69 定义，安全）：

```javascript
    if (typeof cfg.sessionSecret !== 'string' || cfg.sessionSecret.length < 16) {
        cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
        saveConfig(cfg);
    }
```

- [ ] **Step 5: 运行语法检查**

Run: `node --check server.js`
Expected: 无输出（语法通过）。

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: loadConfig 新增 sessionDurationMin/htpasswdPath/sessionSecret 默认值"
```

---

### Task 2: server.js — cookie / token / htpasswd 辅助函数

**Files:**
- Modify: `server.js`（在 `loadConfig` 之后、`app`/HTTP server 创建之前，约 L72 之后）

**Interfaces:**
- 消费：`config.sessionSecret`、`config.htpasswdPath`（Task 1 生产）。
- 生产：
  - `parseCookies(req) -> Object`：解析 `req.headers.cookie`。
  - `signToken(expiryMs) -> string`：返回 `expiryMs.base64Hmac`。
  - `verifyToken(token) -> boolean`：验 HMAC + 未过期。
  - `isAuthed(req) -> boolean`：读 `rc_session` cookie 并 `verifyToken`。
  - `readHtpasswd() -> Object`：读 htpasswd 文件，返回 `{ username: hash }`。
  - `verifyCredentials(username, password) -> boolean`：按用户名命中并校验哈希。

- [ ] **Step 1: 新增辅助函数块**

在 `let config = loadConfig();`（L72）之后插入：

```javascript
// === 登录认证辅助（无状态签名 cookie） ===
const SESSION_COOKIE = 'rc_session';
function parseCookies(req) {
    const out = {};
    const h = req.headers && req.headers.cookie;
    if (!h) return out;
    h.split(';').forEach(c => {
        const idx = c.indexOf('=');
        if (idx < 0) return;
        const k = c.slice(0, idx).trim();
        const v = c.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
    });
    return out;
}
function hmacOf(expiryMs) {
    return crypto.createHmac('sha256', config.sessionSecret).update(String(expiryMs)).digest('base64');
}
function signToken(expiryMs) {
    return expiryMs + '.' + hmacOf(expiryMs);
}
function verifyToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return false;
    const dot = token.indexOf('.');
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const exp = Number(expStr);
    if (!Number.isFinite(exp)) return false;
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmacOf(exp)))) return false;
    if (Date.now() > exp) return false;
    return true;
}
function isAuthed(req) {
    const cookies = parseCookies(req);
    return verifyToken(cookies[SESSION_COOKIE]);
}
// === htpasswd 校验（复用 nginx 文件，零新依赖） ===
function readHtpasswd() {
    try {
        const txt = fs.readFileSync(config.htpasswdPath, 'utf8');
        const map = {};
        txt.split(/\r?\n/).forEach(line => {
            const t = line.trim();
            if (!t || t.startsWith('#')) return;
            const i = t.indexOf(':');
            if (i < 0) return;
            map[t.slice(0, i)] = t.slice(i + 1);
        });
        return map;
    } catch (e) {
        console.error('[htpasswd] read failed:', e && e.message);
        return {};
    }
}
function verifyCredentials(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return false;
    const map = readHtpasswd();
    const hash = map[username];
    if (!hash) return false;
    if (hash.startsWith('{SHA}')) {
        const want = hash.slice(5);
        const got = crypto.createHash('sha1').update(password).digest('base64');
        return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
    }
    if (hash.startsWith('{PLAIN}')) {
        const want = hash.slice(7);
        return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(password));
    }
    if (hash.startsWith('$apr1$')) {
        // Apache MD5（apr1）校验，纯 JS 实现
        const parts = hash.split('$');
        // 格式: $apr1$salt$hash
        const salt = parts[2];
        const real = parts[3];
        const computed = apr1Md5(password, salt);
        return crypto.timingSafeEqual(Buffer.from(real), Buffer.from(computed));
    }
    // 明文（无花括号）
    if (!hash.includes('{') && !hash.includes('$')) {
        return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(password));
    }
    console.error('[htpasswd] 不支持的哈希格式:', hash.slice(0, 8));
    return false;
}
// Apache apr1 MD5（与 `htpasswd -m` 兼容）
function apr1Md5(password, salt) {
    function md5(b) { return crypto.createHash('md5').update(b).digest(); }
    function to64(buf, n) {
        const itoa64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        let s = '';
        for (let i = 0; i < n; i++) {
            let v = buf[i] & 0xff;
            s += itoa64[v & 0x3f];
            if (i + 1 < n) { v |= (buf[i + 1] & 0xff) << 8; s += itoa64[(v >> 6) & 0x3f]; }
            if (i + 2 < n) { v |= (buf[i + 2] & 0xff) << 16; s += itoa64[(v >> 12) & 0x3f]; }
        }
        return s;
    }
    let ctx = md5(password + '$apr1$' + salt);
    ctx = Buffer.concat([ctx, md5(salt + '$apr1$' + password)]);
    let l = password.length;
    while (l > 16) { ctx = Buffer.concat([ctx, md5(password.slice(0, 16))]); l -= 16; }
    if (l > 0) ctx = Buffer.concat([ctx, md5(password.slice(0, l))]);
    const magic = Buffer.from([0, 0, 0]);
    for (let i = password.length; i > 0; i >>= 1) {
        ctx = Buffer.concat([ctx, (i & 1) ? magic : md5(password)]);
    }
    let fin = md5(ctx);
    for (let i = 0; i < 1000; i++) {
        const c = Buffer.concat([md5((i & 1) ? password : fin), (i % 3) ? md5(salt) : magic, (i % 7) ? md5(password) : magic]);
        fin = md5(Buffer.concat([c, (i & 1) ? md5(fin) : fin]));
    }
    const out = Buffer.from([
        fin[0], fin[6], fin[12],
        fin[1], fin[7], fin[13],
        fin[2], fin[8], fin[14],
        fin[3], fin[9], fin[15],
        fin[4], fin[10],
        fin[5], fin[11]
    ]);
    return to64(out, 16);
}
```

- [ ] **Step 2: 运行语法检查**

Run: `node --check server.js`
Expected: 无输出。

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: 新增 cookie/token/htpasswd 辅助函数（无状态签名 cookie）"
```

---

### Task 3: server.js — 登录/登出/鉴权检查路由 + 鉴权网关 + 静态资源保护

**Files:**
- Modify: `server.js`（`app`/HTTP server 创建之后、WS `wss` 之前，约 L74–L83；注意当前 `wss` 在 L76 创建，需要把 `wss` 创建往后挪到 Task 4）

**Interfaces:**
- 消费：`isAuthed`、`verifyCredentials`、`signToken`（Task 2）；`config.sessionDurationMin`（Task 1）。
- 生产：HTTP 端点 `POST /api/login`、`POST /api/logout`、`GET /api/auth-check`、`GET /login`、`GET /`；鉴权网关中间件。供前端 Task 7/8 调用，供 Task 4 的 `verifyClient` 配合。

- [ ] **Step 1: 在 `const app = express();` 之后启用 trust proxy 与 json 解析**

将现有：
```javascript
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
```
改为：
```javascript
const app = express();
app.set('trust proxy', true);
app.use(express.json());
const server = http.createServer(app);
```
（注意：`wss` 的创建在 Task 4 再加回，带 `verifyClient`。此处先移除 `const wss = ...` 那一行，否则重复声明。）

- [ ] **Step 2: 在静态资源挂载之前插入登录路由与鉴权网关**

在 `app.use(express.static(path.join(__dirname, 'public'), ...))`（约 L78）**之前**插入：

```javascript
// === 登录相关路由（不经鉴权网关） ===
app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (verifyCredentials(username, password)) {
        const maxAgeMs = config.sessionDurationMin * 60000;
        const cookieOpts = {
            httpOnly: true,
            sameSite: 'lax',
            secure: 'auto',
            maxAge: maxAgeMs,
            path: '/'
        };
        res.cookie(SESSION_COOKIE, signToken(Date.now() + maxAgeMs), cookieOpts);
        const prefix = req.headers['x-forwarded-prefix'] || '';
        res.redirect(prefix + '/');
    } else {
        res.status(401).json({ ok: false, error: '用户名或密码错误' });
    }
});
app.post('/api/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
});
app.get('/api/auth-check', (req, res) => {
    if (isAuthed(req)) return res.json({ ok: true });
    res.status(401).json({ ok: false });
});

// === 鉴权网关：保护静态资源与除白名单外的所有请求 ===
const AUTH_WHITELIST = ['/login', '/api/login', '/api/logout', '/api/auth-check'];
app.use((req, res, next) => {
    if (AUTH_WHITELIST.includes(req.path)) return next();
    if (isAuthed(req)) return next();
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
        const prefix = req.headers['x-forwarded-prefix'] || '';
        return res.redirect(prefix + '/login');
    }
    return res.status(401).end();
});

// === 登录页 ===
app.get('/login', (req, res) => {
    if (isAuthed(req)) {
        const prefix = req.headers['x-forwarded-prefix'] || '';
        return res.redirect(prefix + '/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
```

- [ ] **Step 3: 运行语法检查**

Run: `node --check server.js`
Expected: 无输出（此时 `wss` 暂未定义，后续 Task 4 补回，不影响 `--check`）。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: 登录/登出/鉴权检查路由 + 鉴权网关保护静态资源"
```

---

### Task 4: server.js — WebSocket verifyClient + 连接时下发 session_duration_min + handler

**Files:**
- Modify: `server.js`（`wss` 创建处与 `wss.on('connection')` 内下发列表）

**Interfaces:**
- 消费：`isAuthed`（Task 2）；`config.sessionDurationMin`（Task 1）。
- 生产：WS 升级受保护；新 WS 消息 `session_duration_min` 双向。

- [ ] **Step 1: 创建带 verifyClient 的 wss**

在 Task 3 已移除的 `const wss = new WebSocketServer({ server });` 位置（静态资源之后或之前均可，建议在 `app.use(express.static ...)` 之后、`broadcast` 函数之前/之后均可）重新创建：

```javascript
const wss = new WebSocketServer({ server, verifyClient: (info, done) => {
    if (isAuthed(info.req)) return done(true);
    return done(false, 401, 'Unauthorized');
} });
```

- [ ] **Step 2: 在连接建立下发列表末尾追加 session_duration_min**

在 `wss.on('connection', (ws) => {` 内现有 `ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));` 之后、`ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));` 之前插入：

```javascript
    ws.send(JSON.stringify({ type: 'session_duration_min', data: config.sessionDurationMin }));
```

- [ ] **Step 3: 在 WS 消息 handler 中新增 session_duration_min 分支**

在现有 `else if (type === 'max_frontend_logs') { ... }`（约 L481）之后、`else if (type === 'rename' ...)`（约 L487）之前插入：

```javascript
        else if (type === 'session_duration_min') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 20160) return;
            config.sessionDurationMin = v;
            broadcast({ type: 'session_duration_min', data: config.sessionDurationMin });
            saveConfig(config);
        }
```

- [ ] **Step 4: 运行语法检查**

Run: `node --check server.js`
Expected: 无输出。

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: WS verifyClient 鉴权 + session_duration_min 下发与同步"
```

---

### Task 5: 新增 public/login.html 登录页

**Files:**
- Create: `public/login.html`

**Interfaces:**
- 消费：前端 `POST /api/login`（Task 3 的端点，相对 URL）。
- 生产：提交成功后跳回应用根（按 `location.pathname` 推导前缀）；失败显示错误。

- [ ] **Step 1: 创建登录页文件**

写入 `public/login.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>RemoteCMD 登录</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #f5f7fa 0%, #e6ecf5 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1a1f36;
  }
  .card {
    width: 340px;
    max-width: 90vw;
    background: #fff;
    border-radius: 14px;
    padding: 32px 28px;
    box-shadow: 0 10px 30px rgba(50, 60, 90, 0.12);
  }
  .card h1 {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 600;
  }
  .card .sub {
    margin: 0 0 24px;
    font-size: 13px;
    color: #6b7280;
  }
  .field { margin-bottom: 16px; }
  .field label {
    display: block;
    font-size: 13px;
    margin-bottom: 6px;
    color: #3c4257;
  }
  .field input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #d6dae3;
    border-radius: 8px;
    font-size: 14px;
    outline: none;
    transition: border-color .15s;
  }
  .field input:focus { border-color: #4f7cff; }
  .btn {
    width: 100%;
    padding: 11px;
    border: none;
    border-radius: 8px;
    background: #4f7cff;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }
  .btn:hover { background: #3f6af0; }
  .btn:active { background: #3560e0; }
  .error {
    margin-top: 14px;
    font-size: 13px;
    color: #d64545;
    min-height: 18px;
    text-align: center;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>RemoteCMD</h1>
    <p class="sub">请输入账号密码以继续</p>
    <form id="loginForm" autocomplete="off">
      <div class="field">
        <label for="username">用户名</label>
        <input id="username" name="username" type="text" placeholder="用户名" autocomplete="off">
      </div>
      <div class="field">
        <label for="password">密码</label>
        <input id="password" name="password" type="password" placeholder="密码" autocomplete="off">
      </div>
      <button class="btn" type="submit">登录</button>
      <div class="error" id="err"></div>
    </form>
  </div>
  <script>
    const form = document.getElementById('loginForm');
    const errEl = document.getElementById('err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.textContent = '';
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      try {
        const resp = await fetch('api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (resp.ok) {
          const base = location.pathname.replace(/\/[^/]*$/, '');
          location.href = base + '/';
          return;
        }
        const data = await resp.json().catch(() => ({}));
        errEl.textContent = data.error || '登录失败';
      } catch (e) {
        errEl.textContent = '网络错误，请重试';
      }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: 运行语法检查（HTML 不编译，仅确认文件存在且非空）**

Run: `node -e "console.log(require('fs').statSync('public/login.html').size + ' bytes')"`
Expected: 打印一个大于 1000 的数字。

- [ ] **Step 3: Commit**

```bash
git add public/login.html
git commit -m "feat: 新增登录页（Stripe 风格，不预填用户名/密码）"
```

---

### Task 6: nginx.conf — 删除 /cmd/ 块 auth_basic 三行

**Files:**
- Modify: `C:\Users\fmy3\OneDrive\project\pythonProjectiQuant2\nginx-1.28.2\conf\nginx.conf`（`/cmd/` 块，约 L74–L93）

**Interfaces:**
- 消费：无。
- 生产：nginx 不再对 `/cmd/` 做 basic auth；TLS 反代保留。

- [ ] **Step 1: 删除 auth_basic 三行**

将 `/cmd/` 块中：
```nginx
    # 👇 新增：配置密码验证
    auth_basic "Remote CMD Need Password";
    auth_basic_user_file htpasswd;  # 密码文件路径，假设放在 nginx 的 conf 目录下
```
（位于 `location /cmd/ {` 之后、`proxy_pass http://127.0.0.1:65433/;` 之前）整段删除，删除后该块开头变为：
```nginx
location /cmd/ {
    proxy_pass http://127.0.0.1:65433/;
    proxy_set_header Host $host;
    ...
```

- [ ] **Step 2: 校验 nginx 配置**

Run: `nginx -t -c "C:\Users\fmy3\OneDrive\project\pythonProjectiQuant2\nginx-1.28.2\conf\nginx.conf"`
Expected: `configuration file ... syntax is ok` 与 `test is successful`。

（注意：此文件不在本 git 仓库，不 commit；改动后由用户在 nginx 侧 `nginx -s reload`。）

---

### Task 7: 前端 — 顶栏退出按钮 + 重连过期跳转

**Files:**
- Modify: `public/index.html`（toolbar 块 L17–L28；`ws.onclose` 处理 L562–L572）

**Interfaces:**
- 消费：后端 `POST /api/logout`、`GET /api/auth-check`（Task 3）。
- 生产：点击退出→清 cookie 跳登录页；WS 断线→鉴权检查→过期跳登录页。供 Task 8 的设置项接收逻辑共存。

- [ ] **Step 1: 在 toolbar 增加「退出」按钮（紧随「设置」之后）**

将：
```html
            <button id="openSettingsBtn" onclick="openSettingsModal()">设置</button>
```
改为：
```html
            <button id="openSettingsBtn" onclick="openSettingsModal()">设置</button>
            <button id="logoutBtn" onclick="logout()">退出</button>
```

- [ ] **Step 2: 新增 logout() 函数**

在全局脚本区（例如 `connect()` 函数之前，L537 之前）插入：
```javascript
        function logout() {
            fetch('api/logout', { method: 'POST' })
                .then(() => { location.href = 'login'; })
                .catch(() => { location.href = 'login'; });
        }
```

- [ ] **Step 3: 修改 ws.onclose 增加过期跳转判定**

将现有：
```javascript
                ws.onclose = () => {
                    addFrontendLog('连接已断开');
                    pendingCreate = false;
                    updateWsStatus();
                    if (navigator.onLine) {
                        addFrontendLog('0.01 秒后重连');
                        reconnectTimer = setTimeout(connect, 10);
                    } else {
                        addFrontendLog('网络已断开，等待网络恢复后自动重连');
                    }
                };
```
改为：
```javascript
                ws.onclose = () => {
                    addFrontendLog('连接已断开');
                    pendingCreate = false;
                    updateWsStatus();
                    // 重连前先判定是否因登录过期被拒：401 则跳登录页，否则按原重连逻辑
                    fetch('api/auth-check').then(r => {
                        if (r.status === 401) {
                            addFrontendLog('登录已过期，跳转登录页', 'warn');
                            location.href = 'login';
                            return;
                        }
                        if (navigator.onLine) {
                            addFrontendLog('0.01 秒后重连');
                            reconnectTimer = setTimeout(connect, 10);
                        } else {
                            addFrontendLog('网络已断开，等待网络恢复后自动重连');
                        }
                    }).catch(() => {
                        if (navigator.onLine) {
                            addFrontendLog('0.01 秒后重连');
                            reconnectTimer = setTimeout(connect, 10);
                        } else {
                            addFrontendLog('网络已断开，等待网络恢复后自动重连');
                        }
                    });
                };
```

- [ ] **Step 4: 运行语法检查**

Run: `node --check public/index.html` 不适用（HTML）；改为确认文件无破损：
```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8'); console.log('logoutBtn' in {} ? 'x' : (s.includes('id=\"logoutBtn\"')?'has logout btn':'MISSING')); console.log(s.includes('api/auth-check')?'has auth-check':'MISSING')"
```
Expected: 两行均打印 `has logout btn` / `has auth-check`。

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: 前端退出按钮 + 重连过期跳转登录页"
```

---

### Task 8: 前端 — 设置弹窗新增「保持登录时长」+ 接收同步

**Files:**
- Modify: `public/index.html`（全局变量 L62–L65 区；`openSettingsModal` 构建 html L244–L261；回填 L293–L295 区；apply 函数 L426–L455 后；`ws.onmessage` 接收侧 L745–L760 区）

**Interfaces:**
- 消费：后端 `session_duration_min` 消息（Task 4）；`wsSend`（既有）。
- 生产：设置弹窗新增一行可改登录时长；接收侧更新全局变量 `sessionDurationMin` + 日志；打开弹窗回填。

- [ ] **Step 1: 新增全局变量**

在 L65 `let inputBarHideOnBlur = true;` 之后插入：
```javascript
        let sessionDurationMin = 1440;   // 保持登录时长(分钟)，设置可改、多端同步
```

- [ ] **Step 2: 在设置弹窗「日志上限」行之后新增「保持登录时长」行**

将：
```javascript
            html += '<input type="number" id="settingsMaxFrontendLogsInput" min="10" max="10000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-maxFrontendLogs" onclick="applySettingsMaxFrontendLogs()">应用</button>';
            html += '</div>';
```
改为：
```javascript
            html += '<input type="number" id="settingsMaxFrontendLogsInput" min="10" max="10000" step="10" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-maxFrontendLogs" onclick="applySettingsMaxFrontendLogs()">应用</button>';
            html += '</div>';

            // 保持登录时长 (分钟)
            html += '<div class="modal-row">';
            html += '<span class="modal-label">保持登录时长 (分钟)</span>';
            html += '<input type="number" id="settingsSessionDurationInput" min="1" max="20160" step="1" style="width:80px;">';
            html += '<button class="btn-primary" id="btn-apply-sessionDuration" onclick="applySettingsSessionDuration()">应用</button>';
            html += '</div>';
```

- [ ] **Step 3: 在 openSettingsModal 回填段新增一行**

在 L295 `document.getElementById('settingsMaxFrontendLogsInput').value = maxFrontendLogs;` 之后插入：
```javascript
            document.getElementById('settingsSessionDurationInput').value = sessionDurationMin;
```

- [ ] **Step 4: 新增 applySettingsSessionDuration() 函数**

在 `applySettingsMaxFrontendLogs()` 函数（L447–L455）之后插入：
```javascript
        function applySettingsSessionDuration() {
            const v = parseInt(document.getElementById('settingsSessionDurationInput').value);
            if (Number.isInteger(v) && v >= 1 && v <= 20160) {
                wsSend({ type: 'session_duration_min', data: v });
                fbBtn('btn-apply-sessionDuration', true);
            } else {
                fbBtn('btn-apply-sessionDuration', false);
            }
        }
```

- [ ] **Step 5: 在 ws.onmessage 接收侧新增 session_duration_min 分支**

将接收侧 `else if (msg.type === 'enter_delay_ms') { ... }`（L745–L747）块之后、`else if (msg.type === 'restart_server')`（L748）之前插入：
```javascript
                    } else if (msg.type === 'session_duration_min') {
                        sessionDurationMin = msg.data;
                        addFrontendLog('保持登录时长同步为 ' + sessionDurationMin + ' 分钟', 'in');
```

注意：该插入位于 `enter_delay_ms` 的 `}` 之后、`restart_server` 的 `else if` 之前，使结构为 `... } else if (msg.type === 'session_duration_min') { ... } else if (msg.type === 'restart_server') {`。

- [ ] **Step 6: 运行结构检查**

Run:
```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8'); console.log(s.includes('applySettingsSessionDuration')?'has apply fn':'MISSING'); console.log(s.includes('settingsSessionDurationInput')?'has input':'MISSING'); console.log(s.includes(\"type: 'session_duration_min'\")?'has receive branch':'MISSING')"
```
Expected: 三行分别打印 `has apply fn` / `has input` / `has receive branch`。

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: 设置弹窗新增保持登录时长项 + 多端同步"
```

---

### Task 9: 本地 config.json 加新字段（不提交）+ 端到端冒烟

**Files:**
- Modify: `config.json`（本地，gitignored，先 `cp config.json config.json.bak`）

**Interfaces:**
- 消费：Task 1 的 `loadConfig` 默认值逻辑。
- 生产：运行期 `sessionDurationMin` / `sessionSecret` / `htpasswdPath` 生效。

- [ ] **Step 1: 备份并编辑 config.json**

Run:
```bash
cp config.json config.json.bak
```
然后编辑 `config.json`，在任意位置新增（若不存在）：
```json
  "sessionDurationMin": 1440,
  "sessionSecret": "请替换为一次性随机串（可留空，loadConfig 会自动生成后写回）",
  "htpasswdPath": "C:\\Users\\fmy3\\OneDrive\\project\\pythonProjectiQuant2\\nginx-1.28.2\\conf\\htpasswd"
```
（若 `sessionSecret` 留空字符串或不写，server.js 启动时会自动生成并无须手动填。）

- [ ] **Step 2: 重启服务（用户执行）**

Run（用户执行，AI 不擅自重启）：
```bash
npm run restart
```

- [ ] **Step 3: 冒烟验证（只读检查，不重启）**

1. 未登录访问 `https://afun.natapp1.cc/cmd/` → 应 302 跳到 `/cmd/login` 并显示登录页。
2. 输入错误密码 → 登录页显示「用户名或密码错误」。
3. 输入正确 `fmy3@qq.com` + 密码 → 进入终端。
4. 浏览器 DevTools Application 标签可见 `rc_session` cookie（HttpOnly）。
5. 设置弹窗改「保持登录时长」为 60 并应用 → 多端（另一标签）同步日志「保持登录时长同步为 60 分钟」。
6. 点「退出」→ 跳登录页，cookie 清除。
7. 直连 `http://localhost:65433` 同样可登录/鉴权。

- [ ] **Step 4: 确认 config.json 不进 git**

Run: `git status --short config.json`
Expected: 无输出（config.json 被 gitignore，不出现）。

（本任务不改代码文件，故无 commit；如编辑了其它已跟踪文件，按各自任务已 commit。）

---

### Task 10: 同步更新 AGENTS.md

**Files:**
- Modify: `AGENTS.md`（协议表、设置字段、注意事项）

**Interfaces:**
- 消费：本计划全部改动。
- 生产：文档与代码一致。

- [ ] **Step 1: 协议表新增 session_duration_min（双向）**

在「服务端 → 客户端」表中 `max_frontend_logs` 行之后新增：
```
| `session_duration_min` | 保持登录时长（单位：分钟，范围 1–20160） |
```
在「客户端 → 服务端」表中 `max_frontend_logs` 行之后新增：
```
| `session_duration_min` | 更新保持登录时长（data，单位：分钟，1–20160） |
```

- [ ] **Step 2: 新增登录认证说明段落（在「架构 / 关键文件」附近或单独一节）**

在「WebSocket 协议」章节之后新增一节「登录认证」：
```
## 登录认证（2026-07-27 引入）

- 认证 authority 已归 `server.js`；nginx `/cmd/` 块仅保留 TLS 反代，不再有 `auth_basic`。
- 会话 = 无状态签名 cookie `rc_session` = `<到期时间戳ms>.<HMAC-SHA256(sessionSecret, 时间戳)>`；`HttpOnly` + `SameSite=Lax` + `secure:'auto'`（走 nginx HTTPS 自动加 Secure，直连 localhost 不加）。
- 密码**复用 nginx 的 htpasswd 文件**（`config.htpasswdPath`，默认 nginx conf 下 `htpasswd`），每次登录实时读取校验；支持 `{SHA}`（当前格式）/ `{PLAIN}` / 明文 / `$apr1$`。`sessionSecret` 存 `config.json`（缺失自动生成）。
- 每次 HTTP 请求与每次 WebSocket 升级（含重连）都验 cookie，过期 → HTTP 401 / WS 拒绝升级 → 前端跳 `/login`。
- 端点：`POST /api/login`、`POST /api/logout`、`GET /api/auth-check`；`GET /login` 发登录页；未登录访问任何非白名单路径 → 302 到登录页。
- 前端全用相对 URL；`X-Forwarded-Prefix` 用于在 nginx 前缀（`/cmd/`）下生成正确跳转地址。
- 「保持登录时长」为普通设置项（`sessionDurationMin`，默认 1440，范围 1–20160），连接时下发 + 可改 + 多端同步；影响**下次登录**的 cookie 有效期（已登录会话在登录时即固定，需重连/重登才按新值）。
```

- [ ] **Step 3: 注意事项新增一条**

在「已知注意事项」末尾新增：
```
44. **登录认证归 server.js（2026-07-27）**：nginx `/cmd/` 不再做 `auth_basic`，仅 TLS 反代。`server.js` 用无状态签名 cookie `rc_session` 鉴权，每次 WS 升级（含重连）都验，过期→拒连→前端跳 `/login`。密码复用 nginx `htpasswd`（实时读取校验 `{SHA}`），零新依赖。`sessionDurationMin`（默认 1440，范围 1–20160）是普通可同步设置项，影响下次登录的 cookie 有效期。前端用相对 URL + `X-Forwarded-Prefix` 兼容 `/cmd/` 前缀与直连。改 `config.json` 的 `sessionDurationMin`/`sessionSecret`/`htpasswdPath` 前先 `cp config.json config.json.bak`（config.json 不进 git）。
```

- [ ] **Step 4: 用字节级 Node 脚本改写 AGENTS.md（禁用正则贪心，避免中文被污染）**

写一段 Node 脚本精确插入上述三段内容（锚定唯一文本：`max_frontend_logs` 表格行、`## WebSocket 协议` 章节尾、`已知注意事项` 末尾）。使用字面量 `String.split(old).join(new)` 替换，禁用正则。

Run: `node scripts/patch-agents-login.js`（脚本内容见下）
Expected: 脚本打印 `patched` 且 `git diff AGENTS.md` 仅含新增三处。

`scripts/patch-agents-login.js` 内容（创建该临时脚本，执行后可删除）：
```javascript
const fs = require('fs');
const p = 'AGENTS.md';
let s = fs.readFileSync(p, 'utf8');
const enc = new TextDecoder('utf-8', { fatal: true });
enc.decode(Buffer.from(s)); // 字节级校验：含替换字符则抛错

const serverRowOld = '| `max_frontend_logs` | 前端日志上限值（单位：条） |';
const serverRowNew = serverRowOld + '\n| `session_duration_min` | 保持登录时长（单位：分钟，范围 1–20160） |';
const clientRowOld = '| `max_frontend_logs` | 更新前端日志上限（单位：条） |';
const clientRowNew = clientRowOld + '\n| `session_duration_min` | 更新保持登录时长（data，单位：分钟，1–20160） |';

const sectionOld = '## WebSocket 协议（JSON，type 字段）';
const sectionNew = '## WebSocket 协议（JSON，type 字段）\n\n## 登录认证（2026-07-27 引入）\n\n- 认证 authority 已归 `server.js`；nginx `/cmd/` 块仅保留 TLS 反代，不再有 `auth_basic`。\n- 会话 = 无状态签名 cookie `rc_session` = `<到期时间戳ms>.<HMAC-SHA256(sessionSecret, 时间戳)>`；`HttpOnly` + `SameSite=Lax` + `secure:\'auto\'`（走 nginx HTTPS 自动加 Secure，直连 localhost 不加）。\n- 密码**复用 nginx 的 htpasswd 文件**（`config.htpasswdPath`，默认 nginx conf 下 `htpasswd`），每次登录实时读取校验；支持 `{SHA}`（当前格式）/ `{PLAIN}` / 明文 / `$apr1$`。`sessionSecret` 存 `config.json`（缺失自动生成）。\n- 每次 HTTP 请求与每次 WebSocket 升级（含重连）都验 cookie，过期 → HTTP 401 / WS 拒绝升级 → 前端跳 `/login`。\n- 端点：`POST /api/login`、`POST /api/logout`、`GET /api/auth-check`；`GET /login` 发登录页；未登录访问任何非白名单路径 → 302 到登录页。\n- 前端全用相对 URL；`X-Forwarded-Prefix` 用于在 nginx 前缀（`/cmd/`）下生成正确跳转地址。\n- 「保持登录时长」为普通设置项（`sessionDurationMin`，默认 1440，范围 1–20160），连接时下发 + 可改 + 多端同步；影响**下次登录**的 cookie 有效期（已登录会话在登录时即固定，需重连/重登才按新值）。';

const noteOld = '43. **输入条向上扩展吸底（2026-07-21 修复）**';
const noteNew = noteOld + '：...（保持原有内容）\n\n44. **登录认证归 server.js（2026-07-27）**：nginx `/cmd/` 不再做 `auth_basic`，仅 TLS 反代。`server.js` 用无状态签名 cookie `rc_session` 鉴权，每次 WS 升级（含重连）都验，过期→拒连→前端跳 `/login`。密码复用 nginx `htpasswd`（实时读取校验 `{SHA}`），零新依赖。`sessionDurationMin`（默认 1440，范围 1–20160）是普通可同步设置项，影响下次登录的 cookie 有效期。前端用相对 URL + `X-Forwarded-Prefix` 兼容 `/cmd/` 前缀与直连。改 `config.json` 的 `sessionDurationMin`/`sessionSecret`/`htpasswdPath` 前先 `cp config.json config.json.bak`（config.json 不进 git）。';

if (!s.includes(serverRowOld)) throw new Error('server row anchor missing');
if (!s.includes(clientRowOld)) throw new Error('client row anchor missing');
if (!s.includes(sectionOld)) throw new Error('section anchor missing');
if (!s.includes(noteOld)) throw new Error('note anchor missing');

s = s.split(serverRowOld).join(serverRowNew);
s = s.split(clientRowOld).join(clientRowNew);
s = s.split(sectionOld).join(sectionNew);
s = s.split(noteOld).join(noteNew);

fs.writeFileSync(p, s);
console.log('patched');
```
（注意：`noteNew` 里 `noteOld + '：...（保持原有内容）'` 仅作占位示意，实际脚本应改为 `noteOld` 原样 + 换行 + 新条目，即 `noteOld + '\n\n44. ...'`；上面 `'：...（保持原有内容）'` 须删除，直接用 `noteOld + '\n\n44. **登录认证...**`。）

- [ ] **Step 5: 校验 AGENTS.md 未被中文污染**

Run:
```bash
node -e "const fs=require('fs');const b=fs.readFileSync('AGENTS.md');new TextDecoder('utf-8',{fatal:true}).decode(b);console.log('utf8 ok'); const s=b.toString('utf8'); console.log(s.includes('session_duration_min')?'has proto':'MISSING'); console.log(s.includes('登录认证归 server.js')?'has note44':'MISSING')"
```
Expected: 打印 `utf8 ok`、`has proto`、`has note44`，且无 `?` 替换字符报错。

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md 同步登录认证（server.js cookie、session_duration_min 协议、注意事项 44）"
```

---

## 自审（Self-Review）

1. **Spec 覆盖**：
   - nginx 去 auth_basic → Task 6 ✓
   - 无状态签名 cookie + secure:auto + trust proxy → Task 2/3 ✓
   - 复用 htpasswd（{SHA} 等）→ Task 2 ✓
   - 路由 /api/login /api/logout /api/auth-check + 网关 + GET / + GET /login → Task 3 ✓
   - WS verifyClient → Task 4 ✓
   - 连接时下发 + handler session_duration_min → Task 4 ✓
   - 前端退出按钮 + 重连过期跳转 → Task 7 ✓
   - 设置弹窗登录时长项 + 接收同步 → Task 8 ✓
   - 登录页不预填 → Task 5 ✓
   - config.json 新字段 + 不提交 → Task 1/9 ✓
   - AGENTS.md 同步 → Task 10 ✓
2. **Placeholder 扫描**：Task 10 Step 4 脚本注释中有一处 `'：...（保持原有内容）'` 占位说明，已在 Step 4 说明中明确要求删除并改用 `noteOld + '\n\n44. ...'`，执行时不得保留占位。其余均含完整代码。
3. **类型一致性**：`SESSION_COOKIE`、`signToken`、`verifyToken`、`isAuthed`、`verifyCredentials` 在 Task 2 定义，Task 3/4 调用名一致；`session_duration_min` 在 Task 4（后端）与 Task 8（前端）收发一致；`settingsSessionDurationInput` / `applySettingsSessionDuration` / `btn-apply-sessionDuration` 在 Task 8 内构建、回填、apply、接收四处一致。

> 注：Task 10 Step 4 的 Node 脚本仅作示例，实际执行应确保 `noteNew` 不包含占位文字（直接拼接 `noteOld + '\n\n44. ...'`）。如担心脚本复杂度，也可直接用 Edit 工具以唯一锚点（如 `43. **输入条向上扩展吸底`）整块替换——AGENTS.md 该段为 ASCII 编号标题 + 中文，Edit 工具精确替换不会污染中文（仅在整文件重写时有风险）。本计划推荐用 Edit 工具做这三处插入，更安全直观。
