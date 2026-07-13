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

    // === 选区模式(method 1)：关闭/恢复鼠标追踪，让 xterm 回到原生拖选 ===
    // 进入：读 TUI 当前鼠标追踪模式并保存，发 DECRST 关闭 1000/1002/1003，
    //       这样 xterm 不再把鼠标事件转发给 PTY，而是像普通网页终端一样自身拖选。
    // 退出：发 DECSET 把保存的模式重新打开，TUI 恢复鼠标交互。
    enableNativeSelection() {
        // 读 TUI 当前鼠标追踪模式并保存，用于退出时精确还原。
        // 注意 xterm 内部命名：1000→'vt200'、1002→'drag'、1003→'any'、9→'x10'。
        const mm = this.term.modes.mouseTrackingMode;  // 'none'|'x10'|'vt200'|'drag'|'any'
        this._savedMouseMode = ({ x10: 1000, vt200: 1000, drag: 1002, any: 1003 })[mm] || null;
        wsSend({ type: 'input', id: this.id, data: '\x1b[?1000l\x1b[?1002l\x1b[?1003l' });
        console.log(`[选区模式] 进入：关闭鼠标追踪（原模式=${mm}${this._savedMouseMode ? '=' + this._savedMouseMode : ''}）`);
    }

    disableNativeSelection() {
        if (this._savedMouseMode) {
            wsSend({ type: 'input', id: this.id, data: '\x1b[?' + this._savedMouseMode + 'h' });
            console.log(`[选区模式] 退出：恢复鼠标追踪（${this._savedMouseMode}）`);
            this._savedMouseMode = null;
        }
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