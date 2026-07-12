# 直接发送快捷键面板（发按键）设计

**日期**：2026-07-12
**类型**：前端新功能
**涉及文件**：`public/index.html`、`public/styles.css`（纯前端，`server.js` 与 WebSocket 协议不动）

## 一、背景与目标

现有底部快捷键栏的按钮都是**预设**的：每个按钮绑死一个转义序列，点一下 `sendInput` 发出去；要新增组合必须先进"编辑"弹窗配置、入库、持久化。

本功能新增一种**无需预设、当场组合并直接发送**的机制：用户随时点击一个"发按键"按钮，弹出小面板，勾选修饰键（Ctrl/Alt/Shift）+ 点主键（字母/功能键），**点主键即当场把组合序列发送到当前活动终端**，不存为预设、不持久化。

## 二、交互定义（已与用户逐项确认）

- **按钮位置**：底部快捷键栏**最左侧**，新增 `发按键` 按钮（排在现有预设快捷键、"编辑"按钮之前）。
- **形态**：弹出式小面板（点"发按键"打开）。
- **组合方式**：方案 A（勾选式组合，非物理按住）。修饰键可多勾。
- **触发**：**点主键即自动发送**，无需再点"发送"按钮。
- **发送后**：**面板自动关闭**（一次一个），下次要再点"发按键"打开。

## 三、数据流

```
点"发按键"按钮 → openSendKeysPanel() 创建面板（DOM 附加 body）
面板内：勾 Ctrl（toggleMod 高亮） → 点 C（pickAndSend）
  → 组合名 = "Ctrl+C"
  → seq = parseHotkey("Ctrl+C")      // 复用现有 parseHotkey，规则不变
  → sendInput(seq)                    // 复用现有 sendInput → wsSend({type:'input', id:activeId, data})
  → closeSendKeysPanel()             // 发完即关
```

**复用点**：`parseHotkey()`（Ctrl 大写公式 / Alt 小写 / Shift 等规则）、`sendInput()`（→ `wsSend input`）、`activeId`（当前终端）。**不新增任何 WebSocket 协议**，`server.js` 完全不动。

## 四、UI 结构与改动位置

### 改动 1：底部栏加"发按键"按钮（index.html 行 ~27-38）

在 `#hotkeys-bar` 内、`#hotkeysList` **之外**新增按钮（放在 `#hotkeysList` 之前，视觉最左）：

```html
<div id="hotkeys-bar">
    <button id="sendKeysBtn" onclick="openSendKeysPanel()">发按键</button>
    <div id="hotkeysList" ...>...</div>
</div>
```

**关键**：放在 `#hotkeysList` **之外**，因为 `renderHotkeys()` 里 `bar.innerHTML=''` 会清空 `#hotkeysList` 全部子节点再重建（只重附 `editBtnEl`/`scrollGroupEl`）。把"发按键"放到 `#hotkeysList` 外可避免被 `renderHotkeys` 误清，无需在 `renderHotkeys` 里额外持有引用。

> 布局注意：`#hotkeys-bar` 现有 `flex-wrap: wrap`，新增按钮作为其直接子元素参与换行。视觉上"发按键"在最左，`#hotkeysList`（含预设按钮+编辑+滚动组）跟其后。

### 改动 2：新增 `openSendKeysPanel()` / `closeSendKeysPanel()`（index.html，`openHotkeyEditor` 附近）

面板结构：
- 标题：`发送按键`
- 修饰键区：`Ctrl` `Alt` `Shift` 三个 toggle 按钮（`onclick="toggleMod(this)"` + `data-mod`，勾选加 `.mod-active` 高亮）+ "清空修饰键"按钮
- 主键区：遍历 `PRIMARY_KEYS` 渲染按钮（`onclick="pickAndSend(this)"`）
- 底部："关闭"按钮（`closeSendKeysPanel()`）
- **无** hkName/hkCmd input、**无**"添加"按钮（不入库）
- 打开时 `activeMods.clear()` 重置勾选

`closeSendKeysPanel()`：移除面板 DOM + `activeMods.clear()`。

### 改动 3：新增常量与状态（index.html 行 ~111 附近）

```js
const MODIFIER_KEYS = ['Ctrl', 'Alt', 'Shift'];
const PRIMARY_KEYS = ['↑', '↓', '→', '←', 'Up', 'Down', 'Right', 'Left', 'Home', 'End', 'PgUp', 'PgDn', 'Insert', 'Delete', 'Tab', 'Enter', 'Esc', 'Backspace', 'Space', 'A', ..., 'Z'];
let activeMods = new Set();
```

（`availableKeys` 原常量保留不动——`showAvailableKeys` 仍用它；本功能只新增 `MODIFIER_KEYS`/`PRIMARY_KEYS`，不改动现有编辑弹窗逻辑。）

### 改动 4：新增 `toggleMod(btn)` / `clearMods()` / `pickAndSend(btn)`

```js
function toggleMod(btn) {
    const mod = btn.dataset.mod;
    if (activeMods.has(mod)) { activeMods.delete(mod); btn.classList.remove('mod-active'); }
    else { activeMods.add(mod); btn.classList.add('mod-active'); }
}
function clearMods() {
    activeMods.clear();
    document.querySelectorAll('.modal-box button.mod-active').forEach(b => b.classList.remove('mod-active'));
}
function pickAndSend(btn) {
    const name = [...activeMods, btn.textContent].join('+');
    sendInput(parseHotkey(name));       // 当场发到当前终端
    addFrontendLog('直接发送: ' + name, 'out');
    closeSendKeysPanel();              // 发完即关（一次一个）
}
```

### 改动 5：CSS（styles.css，`.modal-row` 附近）

新增修饰键高亮样式：

```css
.mod-active { background:#2d6cdf; color:#fff; border-color:#2d6cdf; }
```

## 五、边界情况

1. **无活动终端**（`activeId == null`）：`sendInput` 内置 `if (activeId)` 守卫，静默不发；仍记日志、面板照常关闭。
2. **只勾修饰键不点主键**：仅高亮，不发送（无完整序列）。
3. **不勾修饰键直接点主键**（如点 `C`）：组合名 = `"C"`，`parseHotkey("C")` 走末路 `return s` → 发字母 `C`，合理不拦截。
4. **WS 未连接**：`wsSend` 内置 `readyState !== 1` 守卫，静默失败，面板照常关闭。
5. **重复打开面板**：`openSendKeysPanel()` 开头 `if (panel) panel.remove()` 防重复实例。
6. **点面板外区域**：不做遮罩关闭（与现有编辑弹窗一致），只靠"关闭"按钮，避免误触。

## 六、性能影响分析（AGENTS.md 要求）

- **DOM 节点**：面板打开时新增约 3（修饰）+ 26（字母）+ 19（功能键）+ 少量控制按钮 ≈ 50 个节点，仅面板生命周期内存在，`pickAndSend`/`closeSendKeysPanel` 关闭即销毁，无泄漏。
- **事件监听**：每按钮 1 个 inline `onclick`，无新增全局监听。`toggleMod`/`pickAndSend` 为 O(1) Set 操作 + 一次字符串拼接。
- **回流**：`toggleMod` 仅 toggle 一个 class（单按钮背景色，局部重绘）；`pickAndSend` 仅一次 `sendInput`（无 DOM 布局变化）。
- **网络/协议**：零新增网络往返（复用既有 `input` 消息）、零协议变更、`server.js` 不动。
- **执行频率**：仅用户主动点击触发，低频。
- **结论**：性能影响可忽略。

## 七、遵守的约定

- 纯前端改动，不重启服务器（AGENTS.md 开发纪律：只改前端连现有 65433 刷新即可）。
- 复用服务端权威链路：`sendInput` → `wsSend input`，无乐观状态污染。
- commit 前把 diff 打给用户复核（用户铁律）。
- 改完同步更新 AGENTS.md「已知注意事项」新增条目记录此机制（AGENTS.md 更新规则），并通知用户。
- git 提交显式指定文件，禁止 `git add -A`。

## 八、测试验证方式（连现有 65433，不重启）

1. 浏览器 `http://localhost:65433/`，确认底部栏**最左**出现"发按键"按钮。
2. 点"发按键" → 面板弹出 → 勾 Ctrl → 点 C → 验证：日志出现"直接发送: Ctrl+C"（方向 `→`），当前终端收到 `\x03`（可用 PowerShell 中断 `Read-Host`/`ping -t` 验证）。
3. 验证 Alt+M → 收到 `\x1bm`（Escape + 小写 m，符合注意事项 23）。
4. 验证发完后面板自动关闭、下次打开修饰键已清空。
5. 回归：不重启服务器、旧预设快捷键照常工作。
