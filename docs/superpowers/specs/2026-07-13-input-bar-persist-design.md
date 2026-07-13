# 输入条：焦点移出关闭 + 草稿保留 设计文档

日期：2026-07-13
范围：纯前端（`public/index.html`），不动 `server.js`、不加 WebSocket 消息、不加协议。

## 背景与需求

底部输入条展开后，目前只有两种关闭方式：点「换行」按钮（空内容时退出）、按 Esc。
用户希望新增第三种关闭方式：**输入框展开时，点击其他区域导致焦点移出输入框，输入条也应关闭**。
同时明确内容保留语义：

- **焦点移出（点终端 / 页面空白等）关闭 → 保留草稿**，下次再点开输入条时，上次写的内容原样显示。
- **按回车(Enter)发送 → 清空**（内容已"用掉"，下次打开是干净的）。
- **按 Esc → 清空**（显式取消）。
- 「换行」按钮空内容时退出（此时本就无内容，无保留问题）。

核心动机：防止"手滑点错地方"把辛辛苦苦打的内容弄丢。

## 方案选择

采用 **textarea `blur` 事件 + `relatedTarget` 守卫**（不冒泡版）：

- 监听输入框自身的 `blur`（失焦）事件。
- 失焦时若新焦点落在 `#inputBarWrap` 之外（点到了终端、页面空白、其他区域），则关闭并保留草稿。
- 失焦时若新焦点仍在 `#inputBarWrap` 内部（如点到了「换行」按钮，它也在容器内），则不关闭 —— 避免点「换行」时误触发关闭，与现有"插入换行并保持展开"行为不冲突。

未选方案：`focusout`（冒泡版，挂容器上）—— 效果完全相同，但多绕一层容器、无额外收益；全局 `pointerdown` 监听 —— 触发时机在焦点转移前，且项目已有全局 `pointerdown` 拦截（按钮 `preventDefault`），时序不稳、易冲突。

## 改动点（`public/index.html`）

### 1. `openInputBar()`
删除现有 `L968 inputBarText.value = '';`。
- 改为**保留** textarea 的现有内容；
- `autoGrow(inputBarText)` 按现有内容重算高度，使再点开时草稿原样可见、高度正确。

### 2. `closeInputBar(clear = true)`
新增 `clear` 形参：仅当 `clear` 为真时才执行 `inputBarText.value = ''`。
- `style.height = 'auto'` 重置保留（关闭时收起，打开时由 `autoGrow` 重算）。
- 其余显隐逻辑（`inputBarBtn` / `hotkeysList` / `display`）不变。

### 3. 新增 `closeInputBarPreserve()`
```js
function closeInputBarPreserve() { closeInputBar(false); }  // 保留草稿地关闭
```

### 4. 新增 `blur` 监听（textarea）
```js
inputBarText.addEventListener('blur', (e) => {
    if (inputBarWrap.style.display !== 'flex') return;   // 已关闭则忽略，防止程序化 close 后的二次触发
    const r = e.relatedTarget;
    if (r && inputBarWrap.contains(r)) return;            // 焦点仍在输入条内（如换行按钮），不关闭
    closeInputBarPreserve();                             // 点外部/终端：关闭但保留草稿
});
```

### 5. 调用方语义表
| 触发路径 | 调用 | 内容处理 |
|----------|------|----------|
| 焦点移出（点终端 / 页面空白等） | `closeInputBarPreserve()` | **保留** |
| 回车 Enter 发送 | `closeInputBar()` | **清空** |
| Esc | `closeInputBar()` | **清空** |
| 「换行」空内容退出 | `closeInputBar()` | 无内容，等同清空 |
| 输入条按钮再点（展开时该按钮隐藏，实际不可达） | `closeInputBar()` | 清空 |

## 数据流 / 状态

- 草稿内容存放在 textarea DOM 元素自身的 `value` 中。元素不被销毁，仅 `display:none` 隐藏，因此值自然跨"关闭↔打开"周期留存。
- **保留范围：仅当前页面会话内**。不做跨刷新（F5）持久化，不引入 `localStorage`（符合 YAGNI；若以后需要跨刷新再单独评估）。

## 时序与边界

- **防止二次触发**：`closeInputBar()` 内部先 `sessions.get(activeId)?.focus()` 把焦点交还终端（引发一次 textarea `blur`），再置 `display='none'`。`blur` 事件是异步派发的，等它真正触发时 `display` 已是 `'none'`，守卫 `if (display !== 'flex') return` 会拦掉这次程序化失焦，不会重复关闭、不会误清空。
- **点被全局 `pointerdown` 拦截的按钮（如「设置」）**：因 `preventDefault` 焦点未实际转移，textarea 不 `blur`，输入条不会关闭（设置弹窗盖在上面，关掉后输入条仍在）。这属于"焦点没真的移出"，与需求定义一致，不做特殊处理。
- **点「换行」按钮**：焦点移入「换行」按钮（`#inputBarWrap` 内部）→ `blur` 守卫 `contains` 命中 → 不关闭；随后 `insertNewline()` 正常执行（插入换行 / 空内容退出），与现有行为一致。

## 性能影响

- 新增 **1 个** `blur` 事件监听器，零新增 DOM 节点、零轮询、零网络请求。
- `blur` 同步执行，仅做 `display` 字符串比较 + `contains` 判断（O(小常数)），无布局/回流开销。
- 整体对运行时性能**无影响**。

## 验收标准

1. 展开输入条，输入一段文字，鼠标点终端区域 → 输入条关闭。
2. 再点「输入条」按钮展开 → 刚才的文字原样显示、高度正确。
3. 展开输入条，输入文字，按回车发送 → 输入条关闭，再展开为**空**。
4. 展开输入条，输入文字，按 Esc → 输入条关闭，再展开为**空**。
5. 展开输入条，点「换行」按钮（有内容）→ 不关闭、在光标处插入换行；空内容 → 关闭。
6. 桌面 + Android 真机均验证上述路径；真机点终端收起软键盘符合预期。
