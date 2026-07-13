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
        // 选区模式(method 2)：拦截鼠标序列时用的临时选区状态
        this._selStart = null;
        this._selActive = false;

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

        // 输入转发到服务端；选区模式开启时拦截 SGR 鼠标序列，自行构建选区
        this.term.onData(data => {
            if (window.selectionMode && this._consumeMouseReport(data)) return;
            wsSend({ type: 'input', id: this.id, data: data });
        });

        // 键盘 Ctrl+C：有选区时复制并吞掉，不发给服务端。
        // 必须在捕获阶段拦截——xterm 处理按键时会先清掉选区再触发 onData，
        // 若在 onData 里用 hasSelection() 判断，选区已被清，永远判定为「无选区」。
        this.wrapper.addEventListener('keydown', async e => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey &&
                (e.key === 'c' || e.key === 'C') && this.term.hasSelection()) {
                e.preventDefault();
                e.stopPropagation();
                if (window.copyTermSelection) await window.copyTermSelection(this.term);
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

    // === 选区模式(method 2)：拦截 SGR 鼠标序列，自行解析坐标画选区 ===
    // 当选区模式开启时，TUI 的鼠标拖拽不再转发给 PTY，而是被解析成 xterm 选区。
    // 返回 true 表示这是一条被消费的鼠标序列（已自行处理，不应再转发）。
    _consumeMouseReport(data) {
        // 仅处理 SGR 1006 序列：ESC [ < 按键 ; 列 ; 行 (M|m)
        const m = /^\x1b\[<(\d+);(\d+);(\d+)(M|m)$/.exec(data);
        if (!m) return false;
        const b = parseInt(m[1], 10);
        const x = parseInt(m[2], 10);   // 1 基列
        const y = parseInt(m[3], 10);   // 1 基行（视口相对）
        const suffix = m[4];
        const button = b & 3;            // 0=左 1=中 2=右 3=无按键
        const isMotion = (b & 32) !== 0;

        // 无按键的纯移动(hover)：原样转发给程序，不打日志（避免刷屏）
        if (button === 3) return false;

        const bufRow = (y - 1) + this.term.buffer.active.viewportY;  // 视口行 -> 缓冲区行
        const col0 = x - 1;

        if (suffix === 'm') {
            // 松开：定稿（只在确有选区时记录）
            if (this._selActive) {
                const s = this._selStart;
                console.log(`[选区模式][鼠标] 松开,选区定稿 起=(${s ? s.col : '?'},${s ? s.row : '?'}) 终=(${col0},${bufRow})`);
            }
            this._selActive = false;
            this._selStart = null;
            return true;
        }

        // suffix === 'M'：按下或拖动
        if (!isMotion && button === 0) {
            // 左键按下：开始选区
            this._selStart = { col: col0, row: bufRow };
            this._selActive = true;
            this.term.select(col0, bufRow, 1);
            console.log(`[选区模式][鼠标] 开始选区 col=${col0} row=${bufRow}`);
        } else if (isMotion && this._selActive) {
            // 左键拖动：延伸选区（过程不打日志，避免刷屏）
            this._applySelection(col0, bufRow);
        }
        return true;
    }

    _applySelection(col1, row1) {
        if (!this._selStart) return;
        const s = this._selStart;
        const cols = this.term.cols;
        // 归一化拖拽方向，按读序计算选区长度
        let c0 = s.col, r0 = s.row, c1 = col1, r1 = row1;
        if (r1 < r0 || (r1 === r0 && c1 < c0)) {
            c0 = col1; r0 = row1; c1 = s.col; r1 = s.row;
        }
        let length;
        if (r1 === r0) length = c1 - c0 + 1;
        else length = (cols - c0) + (r1 - r0 - 1) * cols + (c1 + 1);
        if (length <= 0) length = 1;
        this.term.select(c0, r0, length);
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