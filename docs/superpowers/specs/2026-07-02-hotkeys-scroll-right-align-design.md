# 快捷键栏滚动按钮组右对齐设计

## 目标

把 hotkey-bar 底部的 5 个滚动按钮(▲上滑终端、▼下滑终端、▲上滑页面、▼下滑页面、▽到底页面)作为一个整体永远放在最右侧;快捷键占满当前行时,这 5 个按钮整组换到下一行,仍然保持右对齐;再多快捷键时再换一行,行为相同。

「编辑」按钮作为 hotkeyList 的最后一个 DOM 子元素,CSS 换行时自然落在最后一行的最右边,跟最后一个快捷键挨在一起。

两个组之间用纯空隙分隔(flex `margin-left: auto`),无任何视觉元素(竖线/背景/间距)。

## 用户故事

1. 用户有 0-3 个快捷键:全部在一行,「编辑」紧跟最后一个快捷键,5 个滚动按钮在行最右侧。
2. 用户有 4-6 个快捷键:仍然一行装得下,5 个滚动按钮在右。
3. 用户有 10+ 个快捷键:快捷键占满第一行,5 个滚动按钮整组换到第二行,仍然在右。
4. 用户有 20+ 个快捷键:快捷键占满前两行,5 个滚动按钮整组换到第三行,仍然在右。
5. 任何时候:5 个滚动按钮永远在「同一行」(不会拆成 4+1 分两行)。

## 方案对比

| 方案 | 描述 | 结论 |
|------|------|------|
| **A. 纯 CSS + 极小 JS(采纳)** | 5 个滚动按钮包成 `<div id="scrollGroup">`(`display:flex; flex-shrink:0; margin-left:auto`);「编辑」按钮移进 hotkeyList 末尾;`renderHotkeys()` 末尾 re-append「编辑」按钮 | 改动最小,完全复用现有 flex-wrap 机制,符合项目极简主义 |
| B. CSS Grid 布局 | hotkey-bar 改成 `grid-template-columns: 1fr auto`,滚动按钮组永远在第二列 | 列宽固定,「编辑」按钮归属混乱,跟现有 flex 风格不一致 |
| C. 绝对定位 + JS 算行数 | 滚动按钮组 absolute 定位,JS 监听 hotkeyList 行数变化算 top | 复杂、脆弱、需监听 DOM 变化,无必要 |

## 设计细节

### 1. DOM 变更

修改 [public/index.html L28-L36](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L28-L36) 的 `#hotkeys-bar` 块:

```html
<!-- 原结构 -->
<div id="hotkeys-bar">
    <div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;"></div>
    <button id="editBtn">编辑</button>
    <button id="scrollUpBtn">▲上滑终端</button>
    <button id="scrollDownBtn">▼下滑终端</button>
    <button id="scrollXtermUpBtn">▲上滑页面</button>
    <button id="scrollXtermDownBtn">▼下滑页面</button>
    <button id="scrollBottomBtn">▽到底页面</button>
</div>

<!-- 新结构 -->
<div id="hotkeys-bar">
    <div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;">
        <!-- 快捷键按钮(由 renderHotkeys 渲染) -->
        <button id="editBtn">编辑</button>  <!-- 移入此处,作为最后一个子元素 -->
    </div>
    <div id="scrollGroup" style="display:flex;flex-shrink:0;margin-left:auto;">
        <button id="scrollUpBtn">▲上滑终端</button>
        <button id="scrollDownBtn">▼下滑终端</button>
        <button id="scrollXtermUpBtn">▲上滑页面</button>
        <button id="scrollXtermDownBtn">▼下滑页面</button>
        <button id="scrollBottomBtn">▽到底页面</button>
    </div>
</div>
```

**关键点**:
- 「编辑」按钮是 hotkeyList 的最后一个 DOM 子元素(CSS 换行时自动落在最后一行的最右边,跟在最后一个快捷键后面)
- 5 个滚动按钮包成 `#scrollGroup`,整体是 hotkey-bar 的一个 flex 子项
- `#scrollGroup` 的 `display:flex` 默认 `flex-wrap: nowrap`,保证 5 个按钮永远在同一行
- `#scrollGroup` 的 `flex-shrink: 0` 保证 5 个按钮不会被压缩
- `#scrollGroup` 的 `margin-left: auto` 把它推到当前行的最右边
- 当 5 个按钮在当前行放不下时,整组作为单个 flex 子项换到下一行,仍然右对齐

### 2. CSS 变更

**无新增 CSS**。现有规则已足够:

- `#hotkeys-bar` 已有 `display: flex; flex-wrap: wrap; gap: 0; align-items: center;`(见 [public/styles.css L177-L183](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css#L177-L183))
- `.toolbar button, #hotkeys-bar button` 已有 `min-width: 60px`(见 [public/styles.css L207-L209](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css#L207-L209))
- 5 个滚动按钮的 `min-width: 60px` × 5 = 300px 是 `#scrollGroup` 的最小自然宽度,放进 hotkey-bar 时遵循 flex-wrap 行为
- `#scrollGroup` 用 inline style,无需新增 CSS class

### 3. JS 变更

修改 [public/index.html L652-L661](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L652-L661) 的 `renderHotkeys()` 函数,末尾 re-append「编辑」按钮:

```javascript
function renderHotkeys() {
    const bar = document.getElementById('hotkeysList');
    bar.innerHTML = '';
    Object.keys(hotkeys).forEach(name => {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.onclick = () => sendInput(hotkeys[name]);
        bar.appendChild(btn);
    });
    // 「编辑」按钮是 hotkeyList 的最后一个子元素
    // renderHotkeys 重跑时(添加/删除/编辑/移动快捷键)需要重新附加
    // CSS 换行时它会自然落在最后一行的最右边
    const editBtn = document.getElementById('editBtn');
    if (editBtn) bar.appendChild(editBtn);
}
```

**不改动**:
- `document.getElementById('editBtn').onclick = openHotkeyEditor;` —— 元素 ID 不变,事件监听器仍生效
- `setupHoldScroll(btnId, ...)` 的所有 4 个调用 —— 按钮 ID 不变
- 任何 WebSocket 消息处理函数

## 关键交互矩阵

| 场景 | 预期行为 |
|------|---------|
| 0 个快捷键 | hotkeyList 只有一个「编辑」按钮(在最左),5 个滚动按钮在右 |
| 1-3 个快捷键 | 快捷键 + 「编辑」在一行,5 个滚动按钮在同一行右对齐 |
| 4-6 个快捷键 | 一行装下,「编辑」紧跟最后快捷键,5 个滚动按钮在右 |
| 10+ 快捷键 | 快捷键占满第一行,5 个滚动按钮整组换到第二行右对齐 |
| 20+ 快捷键 | 快捷键占满前两行,5 个滚动按钮整组换到第三行右对齐 |
| 添加/删除/编辑快捷键 | renderHotkeys 重跑,「编辑」位置不变 |
| 5 个滚动按钮内部 | 永远在一行,顺序:▲上滑终端,▼下滑终端,▲上滑页面,▼下滑页面,▽到底页面 |
| 终端大/小尺寸切换 | hotkey-bar 宽度跟随 xterm 变化,`syncLayoutWidths` 仍生效 |
| 极小终端(20 列) | 5 个滚动按钮可能溢出,`html { overflow-x: auto }` 兜底 |
| 编辑按钮点击 | 仍能打开快捷键编辑器 |

## 性能影响

### DOM 操作量
- 每次 `renderHotkeys()` 多 1 次 `appendChild`(「编辑」按钮),O(1)
- 添加 1 个 div 元素(`#scrollGroup`)在页面初始化时

### 事件监听器
- 无变化(0 新增,0 减少)

### 布局/回流
- `#hotkeys-bar` 仍是 `flex-wrap: wrap` 容器,无变化
- `#scrollGroup` 自身是 `display: flex` 容器(默认 nowrap),CSS 计算无额外开销
- 「编辑」按钮从 hotkey-bar 直接子元素变成 hotkeyList 子元素,参与 hotkeyList 的 flex-wrap 计算,反而减少 hotkey-bar 一层的 flex item 数量

### 内存
- 新增 1 个 div 元素(`#scrollGroup`),5 个按钮 ID 不变
- 净增加约 100 字节(div 节点 + 几个属性)

### 执行频率
- `renderHotkeys()` 仅在快捷键变化时调用(添加/删除/编辑/移动),频率低(用户手动操作)
- 无定时器、无 WebSocket 触发

### 网络
- 无变化(无新消息、无新请求)

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| `renderHotkeys` 中 `innerHTML = ''` 会清掉「编辑」按钮 | 编辑按钮消失,无法打开快捷键编辑器 | 函数末尾 re-append「编辑」按钮 |
| 小终端下 5 个滚动按钮(300px+)可能溢出 | 视觉上按钮被截断 | 已有 `html { overflow-x: auto }` 兜底,出现水平滚动条 |
| 「编辑」按钮被移到 hotkeyList 内部后,与 hotkeyList 的 flex-wrap 行为耦合 | 快捷键很多时,「编辑」换行位置可能不符合预期 | 用户已确认:「编辑」在最后一个快捷键的右边即可;CSS 换行时它自然在最后一行的最右边 |
| renderHotkeys 频繁调用时 re-append 开销 | 性能损耗 | appendChild 是 O(1),可忽略;renderHotkeys 本身仅在用户操作快捷键时触发 |

## 与现有功能的关系

- **`renderHotkeys()`**:被 `addHotkey` / `delHotkey` / `editHotkey` / `moveUp` 触发,以及收到 `hotkeys` WebSocket 消息时
- **`syncLayoutWidths()`**:无影响(继续把 `#hotkeys-bar` 宽度同步到 `#terminal-container`)
- **`setupHoldScroll(btnId, fn, intervalGetter)`**:无影响(按钮 ID 不变)
- **`editBtn.onclick = openHotkeyEditor`**:无影响(元素 ID 不变,事件仍生效)
- **`bufferQueue` / `switchSession` / `addFrontendLog`**:无影响
- **PM2 重启 / 协议 / config.json**:无影响

## 不在范围

- 5 个滚动按钮的合并(例如 ▲+▼ 合成一个「上下滑」切换按钮)
- 5 个滚动按钮的顺序调整
- 5 个滚动按钮的文案变化
- 「编辑」按钮的样式变化(背景色/边框等)
- 任何后端、协议、config.json 变更
- 任何新增快捷键/新增功能

## 回退方案

保留本次改动的 git commit。必要时 `git revert HEAD` 即可恢复。

回退时无需清理其他文件(本次只改 HTML 和 JS,无配置变更)。
