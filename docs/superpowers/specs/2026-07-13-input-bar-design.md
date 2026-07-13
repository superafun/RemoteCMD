# 底部「输入条」功能设计

日期：2026-07-13
状态：已确认，待实现

## 背景与目标

当前底部快捷键栏（`#hotkeys-bar`）最左侧是「发按键」按钮，点开后弹出一个勾选式组合键面板。
用户希望在「发按键」右边新增一个「输入条」按钮：点开后在同一行内联展开一个**多行输入框**，
用户可直接打字，右侧有「发送」按钮，点击发送把内容发到当前 xterm 终端，发送后输入条自动关闭。

需求要点（来自用户确认）：
- 输入条在「输入条」按钮**同一行**内联展开（非弹层）。
- 输入框为**多行**：回车 = 换行（不发送），框高度随内容自动增高。
- 只有「发送」按钮触发发送；发送时自动在末尾补一个回车执行命令。
- 发送后输入条**自动关闭**。
- 展开时，右侧预设快捷键栏（`#hotkeysList`）暂时隐藏，输入条独占整行。

## 方案取舍

- **方案 A（推荐，内联 textarea）**：在 `#hotkeys-bar` 内「发按键」右侧加「输入条」按钮 + 默认隐藏的内联输入条容器（多行 textarea + 发送按钮）。点「输入条」→ 隐藏 `#hotkeysList`、显示输入条、textarea 自动聚焦并随内容增高；点「发送」→ 发内容 + 自动关闭。纯前端，复用 `sendInput()`，不动 `server.js`。✅ 符合全部要求。
- 方案 B（modal 弹层，类似「发按键」fixed 居中）：被排除——用户要求"同一行内联"，弹层不满足。
- 方案 C（底部常驻一行输入条，不靠按钮展开）：被排除——用户要求按钮触发展开/收起。

## 设计

### 1. DOM 结构（静态写在 `public/index.html`）

`#hotkeys-bar` 现有顺序：`#sendKeysBtn` → `#hotkeysList`。新增后：

```
#sendKeysBtn          (发按键，现状)
#inputBarBtn          (新增：输入条按钮，flex-shrink:0)
#inputBarWrap         (新增：默认 display:none；内含：)
    <textarea id="inputBarText">   (多行，自动增高)
    <button id="inputBarSend">发送</button>
#hotkeysList          (编辑 / 滚动按钮；展开输入条时 display:none)
```

静态写在 HTML 里（不动态创建），靠 `display` 切换显隐。
`#inputBarBtn` 放在 `#sendKeysBtn` 之后、`#inputBarWrap` 之前、`#hotkeysList` 之前。

### 2. 交互流程

- 点「输入条」(`#inputBarBtn`) → 切换开关：
  - 开：隐藏 `#hotkeysList`（`display:none`）、显示 `#inputBarWrap`（`display:flex`）、`textarea` 自动 `focus()`、高度复位（清除上一轮内容/高度）。
  - 关：隐藏 `#inputBarWrap`、恢复 `#hotkeysList`（`display:flex`）、清空 `textarea.value`、高度复位。
  - 再点「输入条」即收起（toggle 语义）。
- `textarea` 输入 → `input` 事件里做自动增高（见第 4 节）。
- 点「发送」(`#inputBarSend`) → 见第 3 节内容处理 → `sendInput()` 发出 → 清空内容、隐藏输入条、恢复 `#hotkeysList`（即"发送后自动关闭"）。
- `Esc` 键在 `textarea` 聚焦且展开时 → 收起输入条（不发送）。

### 3. 发送内容处理（多行 + 补回车执行）

1. 取 `textarea.value`，去掉**末尾**换行：`t = value.replace(/\n+$/, '')`，避免多发空行。
2. 若 `t` 为空 → 仅关闭输入条，不发送（防误触）。
3. 否则把内容内换行 `\n` → `\r`（终端行尾约定），并在末尾补一个 `\r` 触发执行：
   `sendInput(t.replace(/\n/g, '\r') + '\r')`。
   - 例：输入 `cd foo` → 发 `cd foo\r`（执行）。
   - 例：输入 `cd foo` 换行 `ls` → 发 `cd foo\rls\r`（先 cd 再 ls）。

`sendInput()` 走既有 `wsSend({type:'input', id:activeId, data})` 路径，与键盘输入完全一致。

### 4. textarea 自动增高（scrollHeight 技术）

原生 `<textarea>` 默认高度固定、内容溢出时出现内部滚动条，**不会**自动变高。
需用 `scrollHeight`（"内容完整显示所需高度"）手动撑高：

```js
function autoGrow(ta) {
  ta.style.height = 'auto';            // 复位上一次撑开的高度
  ta.style.height = ta.scrollHeight + 'px';  // 设为内容实际所需高度
}
```

绑定在 `textarea` 的 `input` 事件上。CSS 配 `overflow:hidden` 隐藏内部滚动条；设 `max-height`（建议 160px），超过后改回滚动（`overflow:auto`）避免无限撑高。

### 5. CSS 要点（`public/styles.css`）

- `#inputBarBtn`：同 `#sendKeysBtn` 规则 —— `flex-shrink:0; align-self:flex-start;`。
- `#inputBarWrap`：开时 `display:flex; flex:1 1 0; min-width:0; gap:6px; align-items:flex-start;`（输入框占剩余宽，发送按钮顶端对齐且不压缩）。
- `textarea#inputBarText`：`flex:1; min-width:0; resize:none; overflow:hidden; max-height:160px; background:#1e1e1e; color:#eee; border:1px solid #555; font:inherit; line-height:1.4; padding:4px 6px;`（字体/行高与按钮对齐，避免高度错位）。
- `#inputBarSend`：`flex-shrink:0;`（复用 `.toolbar button, #hotkeys-bar button { min-width:60px }`，无需额外处理）。
- `#inputBarWrap` 默认 `display:none`（折叠态）。

### 6. 边界与错误处理

- **空内容**：不发送、只关闭（防误触）。
- **断连**：`sendInput` → `wsSend` 内部已有 `readyState === 1` 检查 + try-catch，静默失败不抛异常，行为与普通键盘输入一致。
- **焦点**：展开时 `focus()` 输入框；收起时输入框失焦（DOM 移除焦点），无需特殊处理 xterm。
- **无活动会话**：`activeId` 为空时 `sendInput` 发往 `activeId=undefined`，服务端 `input` 处理器按现有逻辑不写入，与键盘输入行为一致，不额外处理。
- **textarea 与 xterm 选区不冲突**：输入框是独立 DOM 元素，打字/复制走浏览器原生，不涉及 xterm 选区拦截（无需复用 Ctrl+C 选区复制逻辑）。

### 7. 性能影响

- DOM：静态新增 1 个 textarea + 1 个按钮 + 1 个容器，零动态创建/销毁。
- 事件：`textarea` 1 个 `input` 监听（仅输入时触发，频率低）+ 按钮 2 个 `onclick` + 1 个 `keydown`(Esc)；无 `keydown` 捕获阶段拦截、无轮询。
- 布局：切换显隐仅改 `display`，一次回流；`autoGrow` 每次输入读取一次 `scrollHeight`（廉价），`height=auto` 复位 + 重设高度为两次写，均在输入回调内、频率低。
- 网络/协议：零变更，纯前端改动，不重启服务器（刷新网页即生效）。

## 涉及文件

- `public/index.html`：新增 `#inputBarBtn` / `#inputBarWrap` / `#inputBarText` / `#inputBarSend` 静态 DOM；新增 `toggleInputBar()` / `sendInputBar()` / `autoGrow()` 函数；绑定事件。
- `public/styles.css`：新增上述元素样式。
- `server.js`：无改动。

## 验证方式

1. 后端在跑时（`Get-NetTCPConnection -LocalPort 65433` 检查），刷新网页。
2. 点「输入条」→ 出现内联输入框，预设快捷键栏隐藏。
3. 输入单行 `echo hello` → 点发送 → xterm 执行并输出，输入条关闭、快捷键栏恢复。
4. 再点「输入条」→ 输入多行（`cd \` 换行 `dir`）→ 点发送 → 两行依次执行。
5. 输入内容回车换行 → 框高度自动增高；超长后转滚动。
6. 空内容点发送 → 仅关闭不发送。
7. Esc 收起、再点「输入条」收起均正常。
8. 安卓真机用 HTTPS 访问验证布局（输入条与按钮同一行、独占整行）。
