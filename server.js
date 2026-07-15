const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const CONFIG_PATH = path.join(__dirname, 'config.json');
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const def = {
            sizeSlots: { large: { rows: 60, cols: 120 }, small: { rows: 24, cols: 80 } },
            currentSize: 'large',
            hotkeys: {},
            scrollIntervalTerminal: 100,
            scrollIntervalPage: 100,
            maxBuffer: 10,
            maxFrontendLogs: 50,
            clientTailMax: 4096,
            swipeThreshold: 24,
            swipeClassify: 10,
            showScrollButtons: true,
            bellDebounceMs: 1000,
            bellSoundEnabled: true,
            bellToastEnabled: true,
            bellBeepDurationMs: 300,
            inputBarButtonAction: 'newline',
            inputBarEnterAction: 'send',
            inputBarCloseAfterSend: false,
            enterDelayMs: 300,
            inputBarHideOnBlur: true,
            recentPaths: []
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

    // 保留：旧 maxBuffer 字段是字符数（如 10000），新格式是 MB（如 10）
    if (typeof cfg.maxBuffer === 'number' && cfg.maxBuffer >= 1000) {
        const mb = Math.round(cfg.maxBuffer / 1000000);
        cfg.maxBuffer = (mb >= 1 && mb <= 90) ? mb : 10;
        console.log(`[migration] maxBuffer 自动从字符数转换为 ${cfg.maxBuffer} MB`);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
    if (typeof cfg.maxBuffer !== 'number' || cfg.maxBuffer < 1 || cfg.maxBuffer > 90) cfg.maxBuffer = 10;
    if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;
    if (typeof cfg.scrollIntervalTerminal !== 'number' || cfg.scrollIntervalTerminal < 1 || cfg.scrollIntervalTerminal > 1000) cfg.scrollIntervalTerminal = 100;
    if (typeof cfg.scrollIntervalPage !== 'number' || cfg.scrollIntervalPage < 1 || cfg.scrollIntervalPage > 1000) cfg.scrollIntervalPage = 100;
    if (typeof cfg.swipeThreshold !== 'number' || cfg.swipeThreshold < 1 || cfg.swipeThreshold > 200) cfg.swipeThreshold = 24;
    if (typeof cfg.swipeClassify !== 'number' || cfg.swipeClassify < 1 || cfg.swipeClassify > 100) cfg.swipeClassify = 10;
    if (typeof cfg.showScrollButtons !== 'boolean') cfg.showScrollButtons = true;
    if (typeof cfg.bellDebounceMs !== 'number' || cfg.bellDebounceMs < 100 || cfg.bellDebounceMs > 10000) cfg.bellDebounceMs = 1000;
    if (typeof cfg.bellSoundEnabled !== 'boolean') cfg.bellSoundEnabled = true;
    if (typeof cfg.bellToastEnabled !== 'boolean') cfg.bellToastEnabled = true;
    if (typeof cfg.bellBeepDurationMs !== 'number' || cfg.bellBeepDurationMs < 50 || cfg.bellBeepDurationMs > 2000) cfg.bellBeepDurationMs = 300;
    if (cfg.inputBarButtonAction !== 'newline' && cfg.inputBarButtonAction !== 'send') cfg.inputBarButtonAction = 'newline';
    if (cfg.inputBarEnterAction !== 'newline' && cfg.inputBarEnterAction !== 'send') cfg.inputBarEnterAction = 'send';
    if (typeof cfg.inputBarCloseAfterSend !== 'boolean') cfg.inputBarCloseAfterSend = false;
    if (typeof cfg.inputBarHideOnBlur !== 'boolean') cfg.inputBarHideOnBlur = true;
    if (typeof cfg.enterDelayMs !== 'number' || cfg.enterDelayMs < 50 || cfg.enterDelayMs > 3000) cfg.enterDelayMs = 300;
    return cfg;
}
function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();
// 缓存 maxBuffer 对应的字符数（1 MB = 1,000,000 字符），仅在配置变更时重算
let maxBufferChars = (config.maxBuffer || 10) * 1000000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

// 调整所有 PTY 尺寸
function resizeAllPtys(rows, cols) {
    Object.values(sessions).forEach(s => s.pty.resize(cols, rows));
}

function broadcast(msg) {
    wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(msg)));
}

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
    // bellTimer: 去抖定时器；bellArmed: 是否处于"待响铃"状态（仅当本次会话已出现过 \x07 时为 true）。
    // 任何后续输出（含 \x07 本身和任何其他字节）都会 clearTimeout 重置 timer；只有"输出静止 N ms"且 bellArmed 才广播。
    // TUI 持续输出 → timer 不断重置，bellArmed=true 但永远不会到点 → 0 次通知。
    // TUI 停下 1 秒 → timer 到点 → 1 次通知。
    sessions[newId] = { pty: ptyProcess, buffer: '', inputLine: '', name: computeSmartName(), bellTimer: null, bellArmed: false };
    // buffer 保留原始字节（含可能的 \x07），便于前端重连时完整回放
    ptyProcess.onData((d) => {
        sessions[newId].buffer += d;
        // 滞回式：超 2x 才截断，截到 1x（避免每帧 O(N) slice）
        if (sessions[newId].buffer.length > maxBufferChars * 2) {
            sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
        }
        // === BEL 去抖：任何输出都重置 timer，含 \x07 时把 bellArmed 置 true ===
        if (sessions[newId].bellTimer) {
            clearTimeout(sessions[newId].bellTimer);
            sessions[newId].bellTimer = null;
        }
        if (d.includes('\x07')) sessions[newId].bellArmed = true;
        if (sessions[newId].bellArmed) {
            sessions[newId].bellTimer = setTimeout(() => {
                sessions[newId].bellTimer = null;
                sessions[newId].bellArmed = false;
                broadcast({ type: 'bell', id: newId });
            }, config.bellDebounceMs);
        }
        // data 消息：原样透传（含 \x07）。
        // xterm 收到 \x07 是不可见控制字符，不会破坏渲染；前端 buffer 始终与后端 buffer 一致，重连回放无差异。
        broadcast({ type: 'data', id: newId, data: d });
    });
    ptyProcess.onExit(() => {
        if (sessions[newId] && sessions[newId].bellTimer) {
            clearTimeout(sessions[newId].bellTimer);
        }
        delete sessions[newId];
        broadcast(buildListMsg());
    });
    broadcast(buildListMsg());
}

wss.on('connection', (ws) => {
    // === 先发影响 list 处理的设置（size_slots + current_size + client_tail_max），再发 list ===
    // 这样前端 list 处理器可以无条件从 sizeSlots[currentSize] 取值 resize 新会话,
    // requestBuffer 也用真实的 clientTailMax 截断 clientTail（不再用默认 4096）
    // 不区分"首次连接"和"后续新建"两条路径（2026-07-02 重构 + 2026-07-02 扩展）
    //
    // 2026-07-03 修复:首次连接时 createSession() 内部 broadcast(list) 会发给新 ws(此时 wss.clients 已包含新 ws)
    // 如果在 createSession() 之后才 ws.send 设置,新 ws 会先收到 list,导致 sizeSlots/currentSize 尚未就绪时报错
    // 修复方式:先 ws.send 设置,再 createSession()(内部 broadcast 包含新会话的 list 给新 ws,顺序仍在设置之后)
    ws.send(JSON.stringify(buildSizeSlotsMsg()));
    ws.send(JSON.stringify({ type: 'current_size', data: config.currentSize }));
    ws.send(JSON.stringify({ type: 'client_tail_max', data: config.clientTailMax }));
    if (Object.keys(sessions).length === 0) {
        // 首次连接：createSession() 内部 broadcast(list) 给所有 ws（含新 ws）
        // 新 ws 接收顺序：size_slots → current_size → client_tail_max → list
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
    ws.send(JSON.stringify({ type: 'max_buffer', data: config.maxBuffer }));
    ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));
    ws.send(JSON.stringify({ type: 'bell_debounce_ms', data: config.bellDebounceMs }));
    ws.send(JSON.stringify({ type: 'bell_sound_enabled', data: config.bellSoundEnabled }));
    ws.send(JSON.stringify({ type: 'bell_toast_enabled', data: config.bellToastEnabled }));
    ws.send(JSON.stringify({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs }));
    ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));
    ws.on('message', (msg) => {
        const p = JSON.parse(msg.toString());
        const { type, id, data } = p;
        if (type === 'create') createSession();
        else if (type === 'input' && sessions[id]) {
            sessions[id].pty.write(data);
            const line = feedInputLine(sessions[id], data);
            if (line) {
                const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/);
                if (m) addRecentPath(m[0]);
            }
        }
        else if (type === 'recent_paths_delete') removeRecentPath(data);
        else if (type === 'kill' && sessions[id]) sessions[id].pty.kill();
        else if (type === 'buffer' && sessions[id]) {
            const buf = sessions[id].buffer;
            const tail = p.tail;
            let data;
            let reset = true;  // 默认全量模式（档 3），需要清空 xterm 重写

            if (tail !== '') {
                if (buf.endsWith(tail)) {
                    // 档 1：未变更
                    data = '';
                    reset = false;
                } else {
                    const i = buf.lastIndexOf(tail);
                    if (i !== -1) {
                        // 档 2：增量推送
                        data = buf.slice(i + tail.length);
                        reset = false;
                    }
                }
            }
            if (data === undefined) {
                // 档 3：全量（空串或 lastIndexOf 没找到）
                data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
                // reset 保持 true
            }

            ws.send(JSON.stringify({ type: 'buffer', id, data, ...(reset ? { reset: true } : {}) }));
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
	else if (type === 'max_buffer') {
            config.maxBuffer = data;
            maxBufferChars = data * 1000000;  // 关键：更新缓存
            broadcast({ type: 'max_buffer', data: config.maxBuffer });
            saveConfig(config);
        }
        else if (type === 'max_frontend_logs') {
            config.maxFrontendLogs = data;
            broadcast({ type: 'max_frontend_logs', data: config.maxFrontendLogs });
            saveConfig(config);
        }
        else if (type === 'client_tail_max') {
            config.clientTailMax = data;
            broadcast({ type: 'client_tail_max', data: config.clientTailMax });
            saveConfig(config);
        }
        else if (type === 'bell_debounce_ms') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 100 || v > 10000) return;
            config.bellDebounceMs = v;
            broadcast({ type: 'bell_debounce_ms', data: config.bellDebounceMs });
            saveConfig(config);
        }
        else if (type === 'bell_sound_enabled') {
            if (typeof data !== 'boolean') return;
            config.bellSoundEnabled = data;
            broadcast({ type: 'bell_sound_enabled', data: config.bellSoundEnabled });
            saveConfig(config);
        }
        else if (type === 'bell_toast_enabled') {
            if (typeof data !== 'boolean') return;
            config.bellToastEnabled = data;
            broadcast({ type: 'bell_toast_enabled', data: config.bellToastEnabled });
            saveConfig(config);
        }
        else if (type === 'bell_beep_duration_ms') {
            const v = parseInt(data);
            if (!Number.isInteger(v) || v < 50 || v > 2000) return;
            config.bellBeepDurationMs = v;
            broadcast({ type: 'bell_beep_duration_ms', data: config.bellBeepDurationMs });
            saveConfig(config);
        }
        else if (type === 'buffer_size' && sessions[id]) {
            ws.send(JSON.stringify({
                type: 'buffer_size',
                id,
                used: sessions[id].buffer.length,
                max: maxBufferChars
            }));
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