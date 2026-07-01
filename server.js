const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const CONFIG_PATH = path.join(__dirname, 'config.json');
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const def = { rows: 60, cols: 118, hotkeys: {}, scrollInterval: 100, maxBuffer: 10, maxFrontendLogs: 50, clientTailMax: 4096 };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(def, null, 2));
        return def;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // 迁移：旧 maxBuffer 字段是字符数（如 10000），新格式是 MB（如 10）
    // 检测规则：值 >= 1000 视为旧字符数（10 MB = 10,000,000 字符远大于 1000）
    if (typeof cfg.maxBuffer === 'number' && cfg.maxBuffer >= 1000) {
        const mb = Math.round(cfg.maxBuffer / 1000000);
        cfg.maxBuffer = (mb >= 1 && mb <= 90) ? mb : 10;
        console.log(`[migration] maxBuffer 自动从字符数转换为 ${cfg.maxBuffer} MB`);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
    // 兜底：缺失或非法值
    if (typeof cfg.maxBuffer !== 'number' || cfg.maxBuffer < 1 || cfg.maxBuffer > 90) {
        cfg.maxBuffer = 10;
    }
    // 防御性默认：老用户 config.json 缺此字段时避免 undefined
    if (cfg.clientTailMax == null) cfg.clientTailMax = 4096;
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

app.use(express.static(path.join(__dirname, 'public')));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm')));
app.use('/addon-web-links', express.static(path.join(__dirname, 'node_modules/@xterm/addon-web-links')));
app.use('/addon-unicode11', express.static(path.join(__dirname, 'node_modules/@xterm/addon-unicode11')));

const sessions = {};
let sessionCounter = 1;

function broadcast(msg) {
    wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(msg)));
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
    const ptyProcess = pty.spawn('powershell.exe', [], {
        name: 'xterm-color',
        cols: config.cols,
        rows: config.rows,
        cwd: process.env.USERPROFILE,
        env: process.env
    });
    sessions[newId] = { pty: ptyProcess, buffer: '', name: computeSmartName() };
    ptyProcess.onData((d) => {
        sessions[newId].buffer += d;
        // 滞回式：超 2x 才截断，截到 1x（避免每帧 O(N) slice）
        if (sessions[newId].buffer.length > maxBufferChars * 2) {
            sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
        }
        broadcast({ type: 'data', id: newId, data: d });
    });
    ptyProcess.onExit(() => {
        delete sessions[newId];        
        broadcast(buildListMsg());
    });
    broadcast(buildListMsg());
}

wss.on('connection', (ws) => {
    if (Object.keys(sessions).length === 0) createSession();
    ws.send(JSON.stringify(buildListMsg()));
    ws.send(JSON.stringify({ type: 'resize', id: 0, data: { rows: config.rows, cols: config.cols } }));
    ws.send(JSON.stringify({ type: 'hotkeys', data: config.hotkeys }));
    ws.send(JSON.stringify({ type: 'scroll_interval', data: config.scrollInterval }));
    ws.send(JSON.stringify({ type: 'max_buffer', data: config.maxBuffer }));
    ws.send(JSON.stringify({ type: 'max_frontend_logs', data: config.maxFrontendLogs }));
    ws.send(JSON.stringify({ type: 'client_tail_max', data: config.clientTailMax }));
    ws.on('message', (msg) => {
        const p = JSON.parse(msg.toString());
        const { type, id, data } = p;
        if (type === 'create') createSession();
        else if (type === 'input' && sessions[id]) sessions[id].pty.write(data);
        else if (type === 'kill' && sessions[id]) sessions[id].pty.kill();
        else if (type === 'buffer' && sessions[id]) {
            const buf = sessions[id].buffer;
            const tail = p.tail;
            let data;
            let pos = null;

            if (typeof tail === 'string' && tail !== '') {
                if (buf.endsWith(tail)) {
                    // 档 1：未变更
                    data = '';
                } else {
                    const i = buf.lastIndexOf(tail);
                    if (i !== -1) {
                        // 档 2：增量推送
                        pos = i + tail.length;
                        data = buf.slice(pos);
                    }
                }
            }
            if (data === undefined) {
                // 档 3：全量（tail 缺/空字符串/lastIndexOf 没找到）
                data = buf.length > maxBufferChars ? buf.slice(-maxBufferChars) : buf;
            }

            // 发送（pos 存在时为增量，缺席时为全量或未变更）
            if (pos === null) {
                ws.send(JSON.stringify({ type: 'buffer', id, data }));
            } else {
                ws.send(JSON.stringify({ type: 'buffer', id, data, pos }));
            }
        }
        else if (type === 'resize') {
            config.rows = data.rows; config.cols = data.cols;
            Object.values(sessions).forEach(s => s.pty.resize(data.cols, data.rows));
            broadcast({ type: 'resize', id: 0, data: { rows: config.rows, cols: config.cols } });
            saveConfig(config);
        }
        else if (type === 'hot_keys') {
            config.hotkeys = data || {};
            broadcast({ type: 'hotkeys', data: config.hotkeys });
            saveConfig(config);
        }
        else if (type === 'scroll_interval') {
            config.scrollInterval = data;
            broadcast({ type: 'scroll_interval', data: config.scrollInterval });
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