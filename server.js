const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { Unicode11Addon: HeadlessUnicode11Addon } = require('@xterm/addon-unicode11');


const CONFIG_PATH = path.join(__dirname, 'config.json');
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const def = {
            sizeSlots: { large: { rows: 60, cols: 120 }, small: { rows: 24, cols: 80 } },
            currentSize: 'large',
            hotkeys: {},
            scrollIntervalTerminal: 100,
            scrollIntervalPage: 100,
            maxFrontendLogs: 50,
            screenHistoryLines: 1000, // headless 终端保留的真实滚屏历史行数（重连可上滚查看）
            swipeThreshold: 24,
            swipeClassify: 10,
            showScrollButtons: true,
            inputBarButtonAction: 'newline',
            inputBarEnterAction: 'send',
            inputBarCloseAfterSend: false,
            enterDelayMs: 300,
            inputBarHideOnBlur: true,
            recentPaths: [],
            sessionDurationHours: 24,
            htpasswdPath: 'C:\\Users\\fmy3\\OneDrive\\project\\pythonProjectiQuant2\\nginx-1.28.2\\conf\\htpasswd'
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(def, null, 2));
        return def;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Array.isArray(cfg.recentPaths)) cfg.recentPaths = [];

    // === sizeSlots 兜底：缺失/非法时填默认值 ===
    if (!cfg.sizeSlots || typeof cfg.sizeSlots !== 'object') cfg.sizeSlots = {};
    if (!cfg.sizeSlots.large) cfg.sizeSlots.large = { rows: 60, cols: 120 };
    if (!cfg.sizeSlots.small) cfg.sizeSlots.small = { rows: 24, cols: 80 };
    for (const k of ['large', 'small']) {
        const s = cfg.sizeSlots[k];
        if (!Number.isInteger(s.rows) || s.rows < 20 || s.rows > 200) s.rows = k === 'large' ? 60 : 24;
        if (!Number.isInteger(s.cols) || s.cols < 20 || s.cols > 200) s.cols = k === 'large' ? 120 : 80;
    }
    // === currentSize 兜底：非 'large'/'small' 时填 'large' ===
    if (cfg.currentSize !== 'large' && cfg.currentSize !== 'small') cfg.currentSize = 'large';

    // 清理已废弃的 legacy 重连同步字段（maxBuffer / clientTailMax / syncMode）
    delete cfg.maxBuffer;
    delete cfg.clientTailMax;
    delete cfg.syncMode;

    if (!Number.isInteger(cfg.screenHistoryLines) || cfg.screenHistoryLines < 0 || cfg.screenHistoryLines > 20000) cfg.screenHistoryLines = 1000;
    if (typeof cfg.scrollIntervalTerminal !== 'number' || cfg.scrollIntervalTerminal < 1 || cfg.scrollIntervalTerminal > 1000) cfg.scrollIntervalTerminal = 100;
    if (typeof cfg.scrollIntervalPage !== 'number' || cfg.scrollIntervalPage < 1 || cfg.scrollIntervalPage > 1000) cfg.scrollIntervalPage = 100;
    if (typeof cfg.swipeThreshold !== 'number' || cfg.swipeThreshold < 1 || cfg.swipeThreshold > 200) cfg.swipeThreshold = 24;
    if (typeof cfg.swipeClassify !== 'number' || cfg.swipeClassify < 1 || cfg.swipeClassify > 100) cfg.swipeClassify = 10;
    if (typeof cfg.showScrollButtons !== 'boolean') cfg.showScrollButtons = true;
    if (cfg.inputBarButtonAction !== 'newline' && cfg.inputBarButtonAction !== 'send') cfg.inputBarButtonAction = 'newline';
    if (cfg.inputBarEnterAction !== 'newline' && cfg.inputBarEnterAction !== 'send') cfg.inputBarEnterAction = 'send';
    if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
    if (typeof cfg.inputBarHideOnBlur !== 'boolean') cfg.inputBarHideOnBlur = true;
    if (typeof cfg.enterDelayMs !== 'number' || cfg.enterDelayMs < 50 || cfg.enterDelayMs > 3000) cfg.enterDelayMs = 300;
    if (typeof cfg.sessionDurationHours !== 'number' || !isFinite(cfg.sessionDurationHours) || cfg.sessionDurationHours <= 0) cfg.sessionDurationHours = 24;
    if (typeof cfg.htpasswdPath !== 'string' || !cfg.htpasswdPath) cfg.htpasswdPath = 'C:\\Users\\fmy3\\OneDrive\\project\\pythonProjectiQuant2\\nginx-1.28.2\\conf\\htpasswd';
    if (typeof cfg.sessionSecret !== 'string' || cfg.sessionSecret.length < 16) {
        cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
        saveConfig(cfg);
    }
    return cfg;
}
function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();
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
    const a = Buffer.from(sig);
    const b = Buffer.from(hmacOf(exp));
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;
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
        let str = '';
        for (let i = 0; i < n; i++) {
            let v = buf[i] & 0xff;
            str += itoa64[v & 0x3f];
            if (i + 1 < n) { v |= (buf[i + 1] & 0xff) << 8; str += itoa64[(v >> 6) & 0x3f]; }
            if (i + 2 < n) { v |= (buf[i + 2] & 0xff) << 16; str += itoa64[(v >> 12) & 0x3f]; }
        }
        return str;
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


const app = express();
app.set('trust proxy', true);
app.use(express.json());
const server = http.createServer(app);

// === 登录相关路由（不经鉴权网关） ===
app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (verifyCredentials(username, password)) {
        const maxAgeMs = config.sessionDurationHours * 3600000;
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


app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm')));
app.use('/addon-web-links', express.static(path.join(__dirname, 'node_modules/@xterm/addon-web-links')));
app.use('/addon-unicode11', express.static(path.join(__dirname, 'node_modules/@xterm/addon-unicode11')));

const sessions = {};
let sessionCounter = 1;

// 构造 size_slots 全量广播消息
function buildSizeSlotsMsg() {
    return { type: 'size_slots', data: config.sizeSlots };
}

// 调整所有 PTY 尺寸（含 headless 屏幕，保证与所有客户端同尺寸对齐）
function resizeAllPtys(rows, cols) {
    Object.values(sessions).forEach(s => {
        s.pty.resize(cols, rows);
        if (s.screen) { try { s.screen.resize(cols, rows); } catch (e) {} }
    });
}

// 计算 headless 终端可见视口的指纹（FNV-1a），口径与前端 computeViewportHash 一致。
// 仅用于重连"未变更则跳过发 0 字节"的优化；碰撞仅多一次全量，可接受。
function serverViewportHash(screen) {
    const buf = screen.buffer.active;
    const rowCount = screen.rows;
    let s = '';
    for (let i = 0; i < rowCount; i++) {
        const line = buf.getLine(i);
        s += line ? line.translateToString() : '';
        s += '\n';
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

// 等 headless 终端把"当前已排队的全部 write"解析完后，序列化整屏（可见视口 + 有界真实滚屏历史）。
// 关键点：xterm 的 write() 是异步的，必须在最后一个 write 的回调之后才能 serialize，
// 否则会拍到半更新的屏幕（策划阶段已用冒烟测试验证：同步 serialize 会得到残缺屏）。
// sess._writeSeq 是一条"已发出 write 的串行 promise 链"，这里快照当前链尾再序列化。
function serializeScreen(sess) {
    const seq = sess._writeSeq || Promise.resolve();
    return seq.then(() => {
        try {
            return sess.serializeAddon.serialize();
        } catch (e) {
            throw e;
        }
    });
}

function broadcast(msg) {
    wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(msg)));
}

const wss = new WebSocketServer({ server, verifyClient: (info, done) => {
    if (isAuthed(info.req)) return done(true);
    return done(false, 401, 'Unauthorized');
} });

// 服务端日志转发到前端：前端看不到 console，所有 error/warn 必须进前端日志（error 额外触发 toast）
function serverLog(level, text) {
    try { broadcast({ type: 'server_log', level: level, text: String(text) }); } catch (e) {}
}
const _origErr = console.error.bind(console);
console.error = function (...args) {
    _origErr(...args);
    serverLog('error', args.map(a => (a && a.stack) ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
};
const _origWarn = console.warn.bind(console);
console.warn = function (...args) {
    _origWarn(...args);
    serverLog('warn', args.map(a => (a && a.stack) ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
};
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e && e.stack ? e.stack : e); });
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e && e.stack ? e.stack : e); });
// 记录一条最近路径：去重 + 置顶 + 截断到 10 + 写盘 + 广播
function addRecentPath(raw) {
    const p = (raw || '').trim();
    if (!p) return;
    config.recentPaths = [p, ...config.recentPaths.filter(x => x !== p)].slice(0, 10);
    saveConfig(config);
    broadcast({ type: 'recent_paths', data: config.recentPaths, added: p });
}

// 删除一条最近路径：从列表过滤移除 + 落盘 + 广播（与 addRecentPath 同款结构）
function removeRecentPath(raw) {
    const p = (raw || '').trim();
    if (!p) return;
    const before = config.recentPaths.length;
    config.recentPaths = config.recentPaths.filter(x => x !== p);
    if (config.recentPaths.length === before) return; // 本就不在列表，无变化不广播
    saveConfig(config);
    broadcast({ type: 'recent_paths', data: config.recentPaths, deleted: p });
}

// 判定一个盘符路径应记入的"文件夹路径"：
// 是目录 → 本身；是文件 → 其父文件夹；不存在/出错 → null（跳过，不记录）
// 返回 Promise<string|null>
function resolveFolderToRecord(raw) {
    const p = (raw || '').trim();
    if (!p) return Promise.resolve(null);
    return fs.promises.stat(p)
        .then(stats => {
            if (stats.isDirectory()) return normalizePath(p);
            if (stats.isFile()) return normalizePath(path.dirname(p));
            return null;
        })
        .catch(() => null);
}

// 剥掉末尾反斜杠（C:\ 根保留，避免把 C:\ 记成 C:）
function normalizePath(s) {
    if (s.length > 3 && s.endsWith('\\')) return s.slice(0, -1);
    return s;
}

// 把输入字节流累积成"当前输入行"；遇到回车/换行返回完成行并清空，否则返回 null。
// 跳过 ANSI 转义序列（方向键等），处理退格。用于从任意入口（输入条/终端直敲）检测路径。
function feedInputLine(session, data) {
    let s = session.inputLine || '';
    for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (c === '\r' || c === '\n') {
            session.inputLine = '';
            return s;
        } else if (c === '\b' || c === '\x7f') {
            s = s.slice(0, -1);
        } else if (c === '\x1b') {
            // 跳过转义序列：CSI(ESC[) 跳过参数直到最终字节 0x40–0x7E 并吞掉（如 ~ 结尾的 Home/End/PageUp）；
            // 其它 ESC 序列（如 ESC O P 功能键）保持原逻辑，遇到字母结束
            i++;
            if (i < data.length && data[i] === '[') {
                i++;
                while (i < data.length && !/[\x40-\x7e]/.test(data[i])) i++;
            } else {
                while (i < data.length && !/[a-zA-Z]/.test(data[i])) i++;
            }
        } else {
            s += c;
        }
    }
    session.inputLine = s;
    return null;
}

function buildListMsg() {
    const names = {};
    for (const id of Object.keys(sessions)) {
        names[id] = sessions[id].name;
    }
    return { type: 'list', ids: Object.keys(sessions), names };
}

function computeSmartName() {
    // 没有任何会话 → 返回 Shell #1
    const ids = Object.keys(sessions).map(Number);
    if (ids.length === 0) return 'Shell #1';
    // 遍历所有会话，找匹配 /^Shell #(\d+)$/ 的最大数字
    let maxN = 0;
    for (const id of ids) {
        const m = sessions[id].name?.match(/^Shell #(\d+)$/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > maxN) maxN = n;
        }
    }
    if (maxN > 0) return 'Shell #' + (maxN + 1);
    // 全是自定义名 → 回退 Shell #1
    return 'Shell #1';
}

function createSession() {
    const newId = sessionCounter++;
    const slot = config.sizeSlots[config.currentSize];
    // PowerShell 7 (pwsh.exe)。不传 env → node-pty 默认继承父进程 env。
    // PS7 的 PSEdition-aware 模块加载能正确挑出 PS7 版本模块，无需过滤 PSModulePath；
    // 实测过滤反而会误删 `C:\Program Files\WindowsPowerShell\Modules`（PS5.1/PS7 共享的 AllUsers 模块路径）。
    const ptyProcess = pty.spawn('pwsh.exe', ['-ExecutionPolicy', 'Bypass'], {
        name: 'xterm-color',
        cols: slot.cols,
        rows: slot.rows,
        cwd: process.env.USERPROFILE
    });
    sessions[newId] = { pty: ptyProcess, inputLine: '', name: computeSmartName() };
    // === 重连同步：headless 终端维护"当前可见屏幕 + 有界真实滚屏历史" ===
    // scrollback 用有界行数（config.screenHistoryLines，绝不为 0，否则重连无法上滚看历史）。
    // 加载 Unicode11Addon 与客户端一致，保证字符宽度/换行对齐；SerializeAddon 用于重连时序列化整屏。
    // _writeSeq：一条写回调串行链，保证 serialize 前所有 write 都已解析（见 serializeScreen）。
    {
        const screen = new HeadlessTerminal({ scrollback: config.screenHistoryLines || 1000, allowProposedApi: true });
        screen.loadAddon(new HeadlessUnicode11Addon());
        screen.unicode.activeVersion = '11';
        const serializeAddon = new SerializeAddon();
        screen.loadAddon(serializeAddon);
        const slot = config.sizeSlots[config.currentSize];
        try { screen.resize(slot.cols, slot.rows); } catch (e) {}
        sessions[newId].screen = screen;
        sessions[newId].serializeAddon = serializeAddon;
        sessions[newId]._writeSeq = Promise.resolve();
    }
    // headless 终端负责重连同步；不再维护原始字节流
    ptyProcess.onData((d) => {
        // 同步喂给 headless 终端，折叠成当前屏幕状态（重连同步用）。
        // 用写回调串行链 _writeSeq 保证 serialize 前所有 write 已解析（异步时序，不可同步 serialize）。
        const scr = sessions[newId].screen;
        if (scr) {
            sessions[newId]._writeSeq = sessions[newId]._writeSeq.then(() => new Promise(res => {
                try { scr.write(d, res); } catch (e) { res(); }
            })).catch(() => {});
        }
        // data 消息：原样透传（完成标记也照发，终端可见可验证）。
        // 前端 buffer 始终与后端一致，重连回放无差异。
        broadcast({ type: 'data', id: newId, data: d });
    });
    ptyProcess.onExit(() => {
        if (sessions[newId] && sessions[newId].screen) {
            try { sessions[newId].screen.dispose(); } catch (e) {}
        }
        delete sessions[newId];
        broadcast(buildListMsg());
    });
    broadcast(buildListMsg());
}

wss.on('connection', (ws) => {
    // === 先发影响 list 处理的设置（size_slots + current_size），再发 list ===
    // 这样前端 list 处理器可以无条件从 sizeSlots[currentSize] 取值 resize 新会话
    // 不区分"首次连接"和"后续新建"两条路径（2026-07-02 重构 + 2026-07-02 扩展）
    //
    // 2026-07-03 修复:首次连接时 createSession() 内部 broadcast(list) 会发给新 ws(此时 wss.clients 已包含新 ws)
    // 如果在 createSession() 之后才 ws.send 设置,新 ws 会先收到 list,导致 sizeSlots/currentSize 尚未就绪时报错
    // 修复方式:先 ws.send 设置,再 createSession()(内部 broadcast 包含新会话的 list 给新 ws,顺序仍在设置之后)
    ws.send(JSON.stringify(buildSizeSlotsMsg()));
    ws.send(JSON.stringify({ type: 'current_size', data: config.currentSize }));
    ws.send(JSON.stringify({ type: 'screen_history_lines', data: config.screenHistoryLines }));
    if (Object.keys(sessions).length === 0) {
        // 首次连接：createSession() 内部 broadcast(list) 给所有 ws（含新 ws）
        // 新 ws 接收顺序：size_slots → current_size → screen_history_lines → list
        createSession();
    } else {
        // 非首次：直接 ws.send(list)
        ws.send(JSON.stringify(buildListMsg()));
    }
    ws.send(JSON.stringify({ type: 'hotkeys', data: config.hotkeys }));
    ws.send(JSON.stringify({ type: 'scroll_interval_terminal', data: config.scrollIntervalTerminal }));
    ws.send(JSON.stringify({ type: 'scroll_interval_page', data: config.scrollIntervalPage }));
    ws.send(JSON.stringify({ type: 'swipe_threshold', data: config.swipeThreshold }));
    ws.send(JSON.stringify({ type: 'swipe_classify', data: config.swipeClassify }));
    ws.send(JSON.stringify({ type: 'show_scroll_buttons', data: config.showScrollButtons }));
    ws.send(JSON.stringify({ type: 'input_bar_button_action', data: config.inputBarButtonAction }));
    ws.send(JSON.stringify({ type: 'input_bar_enter_action', data: config.inputBarEnterAction }));
    ws.send(JSON.stringify({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend }));
    ws.send(JSON.stringify({ type: 'input_bar_hide_on_blur', data: config.inputBarHideOnBlur }));
    ws.send(JSON.stringify({ type: 'enter_delay_ms', data: config.enterDelayMs }));
    ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));
    ws.send(JSON.stringify({ type: 'session_duration_hours', data: config.sessionDurationHours }));
    ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));
    ws.on('message', (msg) => {
        const p = JSON.parse(msg.toString());
        const { type, id, data } = p;
        if (type === 'create') createSession();
        else if (type === 'input' && sessions[id]) {
            sessions[id].pty.write(data);
            const line = feedInputLine(sessions[id], data);
            if (line && /^\s*(cd|chdir)\b/i.test(line)) {
                const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/);
                if (m) {
                    resolveFolderToRecord(m[0]).then(folder => {
                        if (folder) addRecentPath(folder);
                    });
                }
            }
        }
        else if (type === 'recent_paths_delete') removeRecentPath(data);
        else if (type === 'kill' && sessions[id]) sessions[id].pty.kill();
        else if (type === 'buffer' && sessions[id]) {
            const sess = sessions[id];
            // 重连同步（headless 整屏序列化）：排空 write → 指纹比对 → 未变更发 0 字节，否则整屏序列化
            const screen = sess.screen;
            if (!screen) { return; } // 无 headless 终端则不发屏（靠实时流恢复）
            // 先等所有已排队 write 解析完，再读屏幕/比对/序列化，避免拍到半更新屏
            const seq = sess._writeSeq || Promise.resolve();
            seq.then(() => {
                try {
                    const serverHash = serverViewportHash(screen);
                    if (p.screenHash && p.screenHash === serverHash) {
                        // 未变更：发 0 字节，客户端保持原样
                        ws.send(JSON.stringify({ type: 'buffer', id, data: '' }));
                        return;
                    }
                    // 变更：序列化整个 buffer（可见视口 + 有界真实滚屏历史）发回，客户端 reset+write 重建
                    const ansi = sess.serializeAddon.serialize();
                    ws.send(JSON.stringify({ type: 'buffer', id, data: ansi, reset: true }));
                } catch (e) {
                    // 序列化失败：不发屏，靠实时流恢复，绝不崩
                    console.error('[buffer] serialize failed, skip:', e && e.message);
                }
            }).catch(e => console.error('[buffer] drain failed, skip:', e && e.message));
        }
        else if (type === 'size_slots') {
            // C → S: 写 sizeSlots[sizeMode] + 落盘 + 全量广播
            const sizeMode = p.sizeMode;
            if (sizeMode !== 'large' && sizeMode !== 'small') return;
            const r = parseInt(p.rows);
            const c = parseInt(p.cols);
            if (!Number.isInteger(r) || r < 20 || r > 200) return;
            if (!Number.isInteger(c) || c < 20 || c > 200) return;
            config.sizeSlots[sizeMode] = { rows: r, cols: c };
            saveConfig(config);
            broadcast(buildSizeSlotsMsg());
        }
        else if (type === 'current_size') {
            // C → S: 切 currentSize + 调整所有 PTY + 落盘 + 广播
            // 不做"无变化跳过"：用户点"应用"时 size_slots 已更新槽位，
            // 即使 size 名未变也要按最新槽位 resize PTY 并广播给前端（2026-07-01 修复行数不生效 bug）
            // 始终广播：前端的 sizeSlots 已由上一条 size_slots 消息更新，current_size 触发 xterm resize 使用新槽位
            const size = p.size;
            if (size !== 'large' && size !== 'small') return;
            config.currentSize = size;
            const slot = config.sizeSlots[size];
            resizeAllPtys(slot.rows, slot.cols);
            saveConfig(config);
            broadcast({ type: 'current_size', data: size });
        }
        else if (type === 'hot_keys') {
            config.hotkeys = data || {};
            broadcast({ type: 'hotkeys', data: config.hotkeys });
            saveConfig(config);
        }
        else if (type === 'scroll_interval_terminal') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 1000) return;
            config.scrollIntervalTerminal = v;
            broadcast({ type: 'scroll_interval_terminal', data: config.scrollIntervalTerminal });
            saveConfig(config);
        }
        else if (type === 'scroll_interval_page') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 1000) return;
            config.scrollIntervalPage = v;
            broadcast({ type: 'scroll_interval_page', data: config.scrollIntervalPage });
            saveConfig(config);
        }
        else if (type === 'swipe_threshold') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 200) return;
            config.swipeThreshold = v;
            broadcast({ type: 'swipe_threshold', data: config.swipeThreshold });
            saveConfig(config);
        }
        else if (type === 'swipe_classify') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 1 || v > 100) return;
            config.swipeClassify = v;
            broadcast({ type: 'swipe_classify', data: config.swipeClassify });
            saveConfig(config);
        }
        else if (type === 'show_scroll_buttons') {
            if (typeof data !== 'boolean') return;
            config.showScrollButtons = data;
            broadcast({ type: 'show_scroll_buttons', data: config.showScrollButtons });
            saveConfig(config);
        }
        else if (type === 'input_bar_button_action') {
            if (data !== 'newline' && data !== 'send') return;
            config.inputBarButtonAction = data;
            broadcast({ type: 'input_bar_button_action', data: config.inputBarButtonAction });
            saveConfig(config);
        }
        else if (type === 'input_bar_enter_action') {
            if (data !== 'newline' && data !== 'send') return;
            config.inputBarEnterAction = data;
            broadcast({ type: 'input_bar_enter_action', data: config.inputBarEnterAction });
            saveConfig(config);
        }
        else if (type === 'input_bar_close_after_send') {
            if (typeof data !== 'boolean') return;
            config.inputBarCloseAfterSend = data;
            broadcast({ type: 'input_bar_close_after_send', data: config.inputBarCloseAfterSend });
            saveConfig(config);
        }
        else if (type === 'input_bar_hide_on_blur') {
            if (typeof data !== 'boolean') return;
            config.inputBarHideOnBlur = data;
            broadcast({ type: 'input_bar_hide_on_blur', data: config.inputBarHideOnBlur });
            saveConfig(config);
        }
        else if (type === 'enter_delay_ms') {
            if (typeof data !== 'number' || data < 50 || data > 3000) return;
            config.enterDelayMs = data;
            broadcast({ type: 'enter_delay_ms', data: config.enterDelayMs });
            saveConfig(config);
        }
	else if (type === 'screen_history_lines') {
            // headless 终端 scrollback 在构造时确定，不在运行时热改（避免内部 API 脆弱性）。
            // 新值应用到之后新建的会话；已在运行的会话在下次重连/重建时按新值创建 headless 终端。
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 0 || v > 20000) return;
            config.screenHistoryLines = v;
            broadcast({ type: 'screen_history_lines', data: config.screenHistoryLines });
            saveConfig(config);
        }
        else if (type === 'max_frontend_logs') {
            config.maxFrontendLogs = data;
            broadcast({ type: 'max_frontend_logs', data: config.maxFrontendLogs });
            saveConfig(config);
        }

        else if (type === 'session_duration_hours') {
            const v = parseFloat(data);
            if (!Number.isFinite(v) || v <= 0) return;
            config.sessionDurationHours = v;
            broadcast({ type: 'session_duration_hours', data: config.sessionDurationHours });
            saveConfig(config);
        }

        else if (type === 'rename' && sessions[id]) {
            const name = (data == null ? '' : String(data)).trim().slice(0, 50);
            sessions[id].name = name === '' ? computeSmartName() : name;
            broadcast(buildListMsg());
        }
        else if (type === 'rename_all') {
            // 按 ID 升序遍历，依次命名为 Shell #1, Shell #2 ...
            const sortedIds = Object.keys(sessions).map(Number).sort((a, b) => a - b);
            sortedIds.forEach((id, i) => {
                sessions[id].name = 'Shell #' + (i + 1);
            });
            broadcast(buildListMsg());
        }
        else if (type === 'restart_server') {
            ws.send(JSON.stringify({ type: 'restart_server', data: 'ok' }));
            Object.values(sessions).forEach(s => s.pty.kill());
            setTimeout(() => process.exit(1), 200);
        }
    });
});

server.listen(65433, () => {
    console.log('服务器已启动: http://localhost:65433');
});