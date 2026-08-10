// public/term-session.js
// 封装单个终端会话的所有状态与行为。
// 依赖全局：Terminal, WebLinksAddon, Unicode11Addon, wsSend, addFrontendLog
// （rows/cols 已在 2026-07-01 改用 size_slots/current_size 协议，
//  TermSession 构造时不立即 resize，等 current_size 消息到达后由外部循环调用 resize）
//
// 重连同步：screen 模式（唯一路径）。客户端发可见视口指纹 screenHash，
// 服务端比对后发 0 字节（未变更）或整屏 ANSI（客户端 reset+write 重建）。旧 legacy 字节流机制已移除。

// 计算 xterm 可见视口的指纹：拼接 0..rows-1 行文本后做轻量 FNV-1a 哈希。
// 仅用于重连"未变更则跳过"的优化；不相等时服务端会整屏重发，故哈希碰撞可接受（碰撞仅多一次全量）。
// 口径与服务端 serverViewportHash 一致（同用 translateToString + FNV-1a）。
function computeViewportHash(term) {
    const buf = term.buffer.active;
    const rowCount = term.rows;
    // 见 server.js serverViewportHash 的同款注释：getLine 的下标是含 scrollback 的绝对行号，
    // 必须从 baseY 起算才是可见视口。此处用 baseY 而非 viewportY —— 服务端 headless 没人滚动，
    // 其 viewportY 恒等于 baseY；客户端若改用 viewportY，用户一上滚就与服务端口径不一致。
    const base = buf.baseY;
    let s = '';
    for (let i = 0; i < rowCount; i++) {
        const line = buf.getLine(base + i);
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

class TermSession {
    constructor(id, container) {
        this.id = id;
        this.name = 'Shell #' + id;
        this.pendingBuffer = false;
        // 选区模式(method 1)：进入时关闭鼠标追踪让 xterm 回到原生选区，
        // 退出时恢复 TUI 原本的鼠标追踪模式。
        this._savedMouseMode = null;  // 进入前 TUI 的鼠标追踪编码：1000/1002/1003 或 null

        // 创建 DOM 包装层
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'term-wrapper';
        this.wrapper.style.display = 'none'; // 默认隐藏；创建者由 switchSession 翻成 block
        container.appendChild(this.wrapper);

        // 创建 xterm
        this.term = new Terminal({
            allowProposedApi: true,
            fontFamily: 'Consolas, "Microsoft YaHei", monospace'
        });
        this.term.open(this.wrapper);
        this.term.loadAddon(new WebLinksAddon.WebLinksAddon());
        this.term.loadAddon(new Unicode11Addon.Unicode11Addon());
        this.term.unicode.activeVersion = '11';

        // 输入原样转发到服务端
        this.term.onData(data => {
            wsSend({ type: 'input', id: this.id, data: data });
        });

        // 键盘 Ctrl+C：有选区时复制并吞掉，不发给服务端（见注意事项 34）。
        // 键盘 Ctrl+V：粘贴系统剪贴板内容，覆盖 xterm 默认的 \x16 转发（见注意事项 38）。
        // 二者都必须在捕获阶段拦截——xterm 处理按键时若先动作，默认行为会抢先。
        this.wrapper.addEventListener('keydown', async e => {
            // 快捷键匹配同时接受 e.key / e.code / e.keyCode：
            // 移动端真机外接键盘或某些软键盘按 Ctrl+C/V 时 e.key 常为 'Unidentified'，
            // 真实按键藏在 e.code('KeyC'/'KeyV') 或 e.keyCode(67/86) 里。只判 e.key 会让快捷键
            // 在手机上静默失效，且 xterm 把原始字节(\x03/\x16)漏发到 PTY（见跨端事件通道记忆）。
            const isCopy = e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'c' || e.key === 'C' || e.code === 'KeyC' || e.keyCode === 67);
            const isPaste = e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'v' || e.key === 'V' || e.code === 'KeyV' || e.keyCode === 86);
            if (isCopy && this.term.hasSelection()) {
                e.preventDefault();
                e.stopPropagation();
                if (window.copyTermSelection) await window.copyTermSelection(this.term);
                return;
            }
            if (isPaste) {
                e.preventDefault();
                e.stopPropagation();
                if (window.pasteFromClipboard) await window.pasteFromClipboard(this.term, this.id);
            }
        }, true);
    }

    // === 生命周期 ===
    dispose() {
        // 顺序固定：xterm 先解绑事件，再移除 wrapper
        this.term.dispose();
        this.wrapper.remove();
    }

    // === 写入 ===
    // mode 缺省 'append'，'reset' 时先 reset 再 write。重连同步由服务端 headless 屏幕负责。
    write(data, mode = 'append') {
        if (mode === 'reset') this.term.reset();
        this.term.write(data);
    }

    // === Buffer 协议（screen 模式，唯一路径）===
    // 发可见视口指纹 screenHash，服务端比对后决定发 0 字节（未变更）或整屏 ANSI。
    requestBuffer() {
        const hash = computeViewportHash(this.term);
        this.pendingBuffer = true;
        wsSend({ type: 'buffer', id: this.id, screenHash: hash });
        if (typeof addFrontendLog === 'function') addFrontendLog(`重连请求 发指纹 ${hash} (${this.name})`, 'out');
    }

    handleBufferResponse(msg) {
        this.pendingBuffer = false;
        if (msg.data === '') return 'skip';
        if (msg.reset) { this.write(msg.data, 'reset'); return 'full'; }
        this.write(msg.data); return 'incremental';
    }

    // === 显示控制 ===
    show() {
        this.wrapper.style.display = 'block';
        this.term.focus();
    }

    hide() {
        this.wrapper.style.display = 'none';
    }

    focus() {
        this.term.focus();
    }

    // === 滚动 ===
    scrollToBottom() { this.term.scrollToBottom(); }
    scrollLines(n)   { this.term.scrollLines(n); }

    // === 选区模式(method 1)：关闭/恢复 xterm 自身鼠标追踪，回到原生拖选 ===
    // 关键：鼠标追踪是 xterm 的状态（由 TUI 的 DECSET 输出序列设定），
    // 所以必须用 term.write 把 DECRST/DECSET 当作【终端输出】写给 xterm 自己，
    // 不能用 wsSend input 发给 pty（那样 xterm 不处理、会被 shell 回显成乱码）。
    // 进入：读 TUI 当前鼠标追踪模式并保存，写 DECRST 关闭 1000/1002/1003。
    // 退出：写 DECSET 把保存的模式重新打开。
    enableNativeSelection() {
        // 读当前鼠标追踪模式并保存，用于退出时精确还原。
        // 注意 xterm 内部命名：1000→'vt200'、1002→'drag'、1003→'any'、9→'x10'。
        const mm = this.term.modes.mouseTrackingMode;  // 'none'|'x10'|'vt200'|'drag'|'any'
        this._savedMouseMode = ({ x10: 1000, vt200: 1000, drag: 1002, any: 1003 })[mm] || null;
        this.term.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l');
    }

    disableNativeSelection() {
        if (this._savedMouseMode) {
            this.term.write('\x1b[?' + this._savedMouseMode + 'h');
            const m = this._savedMouseMode;
            this._savedMouseMode = null;
            return m;   // 返回恢复的鼠标模式编码，由 exitSelectMode 统一打日志
        }
        return null;
    }

    sendSgrWheel(dir) {
        const y = Math.ceil(this.term.rows / 2);
        const code = dir > 0 ? 65 : 64;
        const seq = '\x1b[<' + code + ';' + y + ';1M';
        wsSend({ type: 'input', id: this.id, data: seq });
    }

    // === 尺寸 ===
    resize(cols, rows) {
        this.term.resize(cols, rows);
        // PWA fullscreen 模式下 xterm 初始化时 _setDefaultSpacing 可能在字体未完全就绪时被调用，
        // 导致 WidthCache 缓存了错误的字符宽度测量值，container letter-spacing 为 0。
        // 这里在 resize 后强制触发 handleCharSizeChanged，清除 WidthCache 并重新测量，
        // 确保 container letter-spacing 与实际 cellWidth 匹配。
        // 见 PWA 错位排查诊断：PWA .xterm-rows letter-spacing=0px vs 浏览器 -0.00146px。
        try {
            const renderer = this.term._core._renderService._renderer;
            if (renderer && typeof renderer.handleCharSizeChanged === 'function') {
                renderer.handleCharSizeChanged();
            }
        } catch(e) { /* 忽略，不影响主流程 */ }
    }
}