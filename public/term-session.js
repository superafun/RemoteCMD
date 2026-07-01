// public/term-session.js
// 封装单个终端会话的所有状态与行为。
// 依赖全局：Terminal, WebLinksAddon, Unicode11Addon,
//          wsSend, clientTailMax
// （rows/cols 已在 2026-07-01 改用 size_slots/current_size 协议，
//  TermSession 构造时不立即 resize，等 current_size 消息到达后由外部循环调用 resize）
class TermSession {
    constructor(id, container) {
        this.id = id;
        this.name = 'Shell #' + id;
        this.clientTail = '';
        this.pendingBuffer = false;

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

        // 输入转发到服务端
        this.term.onData(data => {
            wsSend({ type: 'input', id: this.id, data: data });
        });
    }

    // === 生命周期 ===
    dispose() {
        // 顺序固定：xterm 先解绑事件，再移除 wrapper
        this.term.dispose();
        this.wrapper.remove();
    }

    // === 写入 ===
    // mode 缺省 'append'，'reset' 时先 reset 再 write
    write(data, mode = 'append') {
        if (mode === 'reset') this.term.reset();
        this.term.write(data);
        this.appendClientTail(data);
    }

    // === Buffer 协议 ===
    requestBuffer() {
        // 发送前确保 tail 不超过阈值（appendClientTail 是滞回式，可能还没裁）
        if (this.clientTail.length > clientTailMax) {
            this.clientTail = this.clientTail.slice(-clientTailMax);
        }
        this.pendingBuffer = true;
        wsSend({ type: 'buffer', id: this.id, tail: this.clientTail });
        addFrontendLog('开始拉取 ' + this.name + ' 缓存');
        this.showBufferLoading();
    }

    handleBufferResponse(msg) {
        this.pendingBuffer = false;
        this.hideBufferLoading();
        if (msg.data === '' && msg.pos == null) return 'skip';
        if (msg.pos != null) { this.write(msg.data); return 'incremental'; }
        if (msg.data)        { this.write(msg.data, 'reset'); return 'full'; }
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