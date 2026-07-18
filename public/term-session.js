// public/term-session.js
// 封装单个终端会话的所有状态与行为。
// 依赖全局：Terminal, WebLinksAddon, Unicode11Addon,
//          wsSend, clientTailMax, syncMode
// （rows/cols 已在 2026-07-01 改用 size_slots/current_size 协议，
//  TermSession 构造时不立即 resize，等 current_size 消息到达后由外部循环调用 resize）

// 计算 xterm 可见视口的指纹：拼接 0..rows-1 行文本后做轻量 FNV-1a 哈希。
// 仅用于重连"未变更则跳过"的优化；不相等时服务端会整屏重发，故哈希碰撞可接受（碰撞仅多一次全量）。
// 口径与服务端 serverViewportHash 一致（同用 translateToString + FNV-1a）。
function computeViewportHash(term) {
    const buf = term.buffer.active;
    const rowCount = term.rows;
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

class TermSession {
    constructor(id, container) {
        this.id = id;
        this.name = 'Shell #' + id;
        this.clientTail = '';
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
        this.term = new Terminal({ allowProposedApi: true });
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
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'c' || e.key === 'C') && this.term.hasSelection()) {
                e.preventDefault();
                e.stopPropagation();
                if (window.copyTermSelection) await window.copyTermSelection(this.term);
                return;
            }
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'v' || e.key === 'V')) {
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
    // mode 缺省 'append'，'reset' 时先 reset 再 write。
    // screen 模式（默认）：不维护 clientTail（由服务端 headless 屏幕负责同步）。
    // legacy 模式：仍追加 clientTail，供断连时发 tail 匹配。
    write(data, mode = 'append') {
        if (mode === 'reset') this.term.reset();
        this.term.write(data);
        if (syncMode === 'legacy') this.appendClientTail(data);
    }

    // === Buffer 协议 ===
    // screen 模式（默认）：发可见视口指纹 screenHash，服务端比对后决定发 0 字节或整屏。
    // legacy 模式：发尾部字节 tail（旧字节流机制，仅作兜底）。
    requestBuffer() {
        if (syncMode === 'legacy') {
            // 发送前确保 tail 不超过阈值（appendClientTail 是滞回式，可能还没裁）
            if (this.clientTail.length > clientTailMax) {
                this.clientTail = this.clientTail.slice(-clientTailMax);
            }
            this.pendingBuffer = true;
            wsSend({ type: 'buffer', id: this.id, tail: this.clientTail });
            if (typeof addFrontendLog === 'function') addFrontendLog(`重连请求[legacy] 发 tail ${this.clientTail.length} 字节 (${this.name})`, 'out');
            this.showBufferLoading();
            return;
        }
        const hash = computeViewportHash(this.term);
        this.pendingBuffer = true;
        wsSend({ type: 'buffer', id: this.id, screenHash: hash });
        if (typeof addFrontendLog === 'function') addFrontendLog(`重连请求[screen] 发指纹 ${hash} (${this.name})`, 'out');
        this.showBufferLoading();
    }

    handleBufferResponse(msg) {
        this.pendingBuffer = false;
        this.hideBufferLoading();
        if (msg.data === '') return 'skip';
        if (msg.reset) { this.write(msg.data, 'reset'); return 'full'; }
        this.write(msg.data); return 'incremental';
    }

    // === 加载动画 ===
    showBufferLoading() {
        if (this.wrapper.querySelector('.buffer-loading')) return;
        const div = document.createElement('div');
        div.className = 'buffer-loading';
        this.wrapper.appendChild(div);
    }

    hideBufferLoading() {
        const el = this.wrapper.querySelector('.buffer-loading');
        if (el) el.remove();
    }

    // === 尾部维护 ===
    appendClientTail(chunk) {
        if (!chunk) return;
        let buf = this.clientTail + chunk;
        // 滞回式：超 2x 才截断，截到 1x（避免每帧 O(N) slice）
        if (buf.length > clientTailMax2) buf = buf.slice(-clientTailMax);
        this.clientTail = buf;
    }

    trimClientTail(max) {
        if (this.clientTail.length > max) {
            this.clientTail = this.clientTail.slice(-max);
        }
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
    }
}