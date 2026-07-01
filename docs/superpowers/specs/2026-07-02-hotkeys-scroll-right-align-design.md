# 快捷键栏滚动按钮组右对齐设计

## 目标

把 hotkey-bar 底部的 5 个滚动按钮(▲上滑终端、▼下滑终端、▲上滑页面、▼下滑页面、▽到底页面)作为一个整体永远放在最右侧;具体行为:5 个按钮会跟着 hotkeyList 内部的 flex-wrap 走,如果当前行有空隙就排在当前行右侧,如果当前行满了才整组换到下一行(仍然右对齐)。

「编辑」按钮作为 hotkeyList 的倒数第二个 DOM 子元素(在 #scrollGroup 之前),CSS 换行时自然落在最后一行的最右边,跟最后一个快捷键挨在一起。

两个组之间用纯空隙分隔(flex `margin-left: auto`),无任何视觉元素(竖线/背景/间距)。

## 用户故事

1. 用户有 0-3 个快捷键:全部在一行,「编辑」紧跟最后一个快捷键,5 个滚动按钮在行最右侧。
2. 用户有 4-6 个快捷键:仍然一行装得下,5 个滚动按钮在右。
3. 用户有 10+ 个快捷键:第一行占满,第二行有 N 个快捷键 + 「编辑」。如果第二行右侧留有 ≥ 5 个按钮宽度的空隙,5 个滚动按钮排在第二行最右侧;否则换到第三行,仍然在右。
4. 用户有 20+ 个快捷键:前两行占满,第三行有 N 个快捷键 + 「编辑」。如果第三行右侧留有 ≥ 5 个按钮宽度的空隙,5 个滚动按钮排在第三行最右侧;否则换到第四行,仍然在右。
5. 任何时候:5 个滚动按钮永远在「同一行」(不会拆成 4+1 分两行)。

## 方案对比

| 方案 | 描述 | 结论 |
|------|------|------|
| **A. 纯 CSS + 极小 JS(采纳)** | 5 个滚动按钮包成 `<div id="scrollGroup">` 放进 `#hotkeysList` 末尾(`display:flex; flex-shrink:0; margin-left:auto`);「编辑」按钮移进 hotkeyList(在 #scrollGroup 之前);用变量 `editBtnEl` / `scrollGroupEl` 持有引用,`renderHotkeys()` 末尾 `appendChild` 回去 | 改动最小,完全复用 hotkeyList 内部的 flex-wrap 机制,「编辑」和 5 个滚动按钮跟快捷键共享同一套换行行为,自然落到有空隙的那一行 |
| B. CSS Grid 布局 | hotkey-bar 改成 `grid-template-columns: 1fr auto`,滚动按钮组永远在第二列 | 列宽固定,「编辑」按钮归属混乱,跟现有 flex 风格不一致 |
| C. 绝对定位 + JS 算行数 | 滚动按钮组 absolute 定位,JS 监听 hotkeyList 行数变化算 top | 复杂、脆弱、需监听 DOM 变化,无必要 |
| D. scrollGroup 放在 #hotkeys-bar 独立子项(早期版本) | scrollGroup 是 hotkey-bar 的兄弟节点,`margin-left:auto` 推到当前行右侧;但 hotkeyList 是单个 flex item,max-content 宽,scrollGroup 经常被推到下一行而非跟随 hotkeyList 内部行 | 不满足「第一行满时,第二行如有空隙则排在第二行」的需求,已弃用 |

## 设计细节

### 1. DOM 变更

修改 [public/index.html L28-L36](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L28-L36) 的 `#hotkeys-bar` 块:**把 `#scrollGroup` 包进 `#hotkeysList` 内部**(而不是作为 `#hotkeys-bar` 的独立子元素)。这样 5 个滚动按钮会跟着 hotkeyList 内部的 flex-wrap 行为走,自然落到有空隙的那一行右侧。

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
        <button id="editBtn">编辑</button>  <!-- 移入此处,作为倒数第二个子元素 -->
        <div id="scrollGroup" style="display:flex;flex-shrink:0;margin-left:auto;">
            <!-- 5 个滚动按钮是 hotkeyList 的最后一个子元素;CSS 换行时它们作为一个整体,跟着有空隙的那一行右侧走 -->
            <button id="scrollUpBtn">▲上滑终端</button>
            <button id="scrollDownBtn">▼下滑终端</button>
            <button id="scrollXtermUpBtn">▲上滑页面</button>
            <button id="scrollXtermDownBtn">▼下滑页面</button>
            <button id="scrollBottomBtn">▽到底页面</button>
        </div>
    </div>
</div>
```

**关键点**:
- 「编辑」按钮是 hotkeyList 的倒数第二个子元素,跟最后一个快捷键挨在一起(CSS 换行时它自然落在最后一行的最右边)
- `#scrollGroup` 包了 5 个滚动按钮,放在 hotkeyList 最末尾(最后一个子元素)
- `#scrollGroup` 的 `display:flex` 默认 `flex-wrap: nowrap`,保证 5 个按钮永远在同一行
- `#scrollGroup` 的 `flex-shrink: 0` 保证 5 个按钮不会被压缩
- `#scrollGroup` 的 `margin-left: auto` 把它推到当前行的最右边
- **关键行为**:`#scrollGroup` 是 hotkeyList 内部的 flex 子项,跟快捷键共享同一套 flex-wrap 行为。如果当前行有空隙,5 个按钮排在当前行右侧;如果当前行满了,5 个按钮整组换到下一行(仍然在右侧)。这正好满足「第一行占满时,第二行如有空隙,5 个按钮排在第二行」的需求。

### 2. CSS 变更

**无新增 CSS**。现有规则已足够:

- `#hotkeys-bar` 已有 `display: flex; flex-wrap: wrap; gap: 0; align-items: center;`(见 [public/styles.css L177-L183](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css#L177-L183))
- `.toolbar button, #hotkeys-bar button` 已有 `min-width: 60px`(见 [public/styles.css L207-L209](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css#L207-L209))
- 5 个滚动按钮的 `min-width: 60px` × 5 = 300px 是 `#scrollGroup` 的最小自然宽度,放进 hotkey-bar 时遵循 flex-wrap 行为
- `#scrollGroup` 用 inline style,无需新增 CSS class

### 3. JS 变更

需要两处修改:

**3.1 保留 editBtn 和 scrollGroup 的引用**(`renderHotkeys` 之前)

修改 [public/index.html](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html) 的全局变量区(L40-65 附近),在 `const terminalContainer = ...` 之后添加:

```javascript
// 保留「编辑」按钮和滚动按钮组的引用(被 renderHotkeys 重新附加)
const editBtnEl = document.getElementById('editBtn');
const scrollGroupEl = document.getElementById('scrollGroup');
```

**为什么需要**:`renderHotkeys()` 中 `bar.innerHTML = ''` 会把 hotkeyList 的所有子元素(包括 `editBtn` 和 `scrollGroup`)从 DOM 树中移除。`document.getElementById('editBtn')` 之后再调用会返回 null(它只搜文档树)。必须用变量持有引用,才能在 `renderHotkeys` 末尾 `appendChild` 回去。

**3.2 修改 `renderHotkeys()` 函数**

修改 [public/index.html L652-L661](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L652-L661) 的 `renderHotkeys()` 函数,末尾 re-append「编辑」按钮和 `#scrollGroup`:

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
    // 「编辑」按钮和 #scrollGroup 是 hotkeyList 的固定尾部元素
    // renderHotkeys 重跑时(添加/删除/编辑/移动快捷键)需要重新附加
    // CSS 换行时,#scrollGroup 会跟着 hotkeyList 的 flex-wrap 行为走,
    // 自然落到有空隙的那一行右侧
    bar.appendChild(editBtnEl);
    bar.appendChild(scrollGroupEl);
}
```

**不改动**:
- `document.getElementById('editBtn').onclick = openHotkeyEditor;` —— 元素引用持久,事件监听器仍生效(替换为引用 `editBtnEl.onclick = openHotkeyEditor;` 更稳妥)
- `setupHoldScroll(btnId, ...)` 的所有 4 个调用 —— 按钮 ID 不变;按钮 DOM 节点被 innerHTML 清掉后再 appendChild 回来,事件监听器仍生效(因为 `addEventListener` 绑在 JS 对象上,不是 DOM 位置上)
- `document.getElementById('scrollBottomBtn').onclick = scrollBottom;` —— 按钮引用持久
- 任何 WebSocket 消息处理函数

**推荐同步改一处**(避免 `getElementById` 失效导致 onclick 失效):把 `document.getElementById('editBtn').onclick = openHotkeyEditor;` 改为 `editBtnEl.onclick = openHotkeyEditor;`。这是顺手的小改,不影响功能。

## 关键交互矩阵

| 场景 | 预期行为 |
|------|---------|
| 0 个快捷键 | hotkeyList 只有一个「编辑」按钮(在最左),5 个滚动按钮在同一行最右侧 |
| 1-3 个快捷键 | 快捷键 + 「编辑」+ 5 个滚动按钮在一行(滚动按钮在右) |
| 4-6 个快捷键 | 一行装下,5 个滚动按钮在右 |
| 10+ 快捷键(第一行满,第二行有 3 个快捷键 + 编辑,右侧有 5+ 按钮空隙) | 第一行满,第二行 = 3 个快捷键 + 编辑 + 5 个滚动按钮(右侧) |
| 10+ 快捷键(第一行满,第二行也有 8+ 个快捷键占满) | 第二行满,第三行 = 5 个滚动按钮(右侧) |
| 20+ 快捷键(前两行满,第三行有部分快捷键) | 前两行满,第三行 = 剩余快捷键 + 编辑 + 5 个滚动按钮(右侧) |
| 添加/删除/编辑快捷键 | renderHotkeys 重跑,「编辑」和 #scrollGroup 位置不变 |
| 5 个滚动按钮内部 | 永远在一行,顺序:▲上滑终端,▼下滑终端,▲上滑页面,▼下滑页面,▽到底页面 |
| 终端大/小尺寸切换 | hotkeyList 宽度跟随 xterm 变化,`syncLayoutWidths` 仍生效 |
| 极小终端(20 列) | 5 个滚动按钮可能溢出,`html { overflow-x: auto }` 兜底 |
| 编辑按钮点击 | 仍能打开快捷键编辑器 |

## 性能影响

### DOM 操作量
- 每次 `renderHotkeys()` 多 2 次 `appendChild`(「编辑」按钮 + `#scrollGroup`),O(1)
- 添加 1 个 div 元素(`#scrollGroup`)在页面初始化时
- 2 个 JS 变量引用(`editBtnEl`、`scrollGroupEl`)

### 事件监听器
- 无变化(0 新增,0 减少)
- 注:被 `innerHTML = ''` 临时摘下后 `appendChild` 回来的按钮元素,事件监听器仍生效(`addEventListener` 绑在 JS 对象上,跟 DOM 位置解耦)

### 布局/回流
- `#hotkeys-bar` 现在只有 1 个子元素(`#hotkeysList`),flex-wrap 在 hotkey-bar 层无意义(可以保留无害,但实际不参与换行)
- `#hotkeysList` 内部仍是 `flex-wrap: wrap`,多 1 个 flex 子项(`#scrollGroup`);CSS 计算开销可忽略
- `#scrollGroup` 自身是 `display: flex` 容器(默认 nowrap),内部 5 个按钮固定单行

### 内存
- 新增 1 个 div 元素(`#scrollGroup`),5 个按钮 ID 不变
- 2 个 JS 变量引用(仅引用,不复制)
- 净增加约 200 字节(div 节点 + 2 个 const 变量 + 几个属性)

### 执行频率
- `renderHotkeys()` 仅在快捷键变化时调用(添加/删除/编辑/移动),频率低(用户手动操作)
- 无定时器、无 WebSocket 触发

### 网络
- 无变化(无新消息、无新请求)

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| `renderHotkeys` 中 `innerHTML = ''` 会清掉「编辑」按钮和 `#scrollGroup`(DOM 树中) | 编辑按钮消失,无法打开快捷键编辑器;5 个滚动按钮消失 | 用 `editBtnEl` / `scrollGroupEl` 变量持有引用,函数末尾 `appendChild` 回去 |
| `getElementById('editBtn')` 在 `innerHTML = ''` 之后返回 null | 后续若在 renderHotkeys 之外用 getElementById 找 editBtn,会失败 | 改用 `editBtnEl` 引用;把 `document.getElementById('editBtn').onclick = openHotkeyEditor;` 替换为 `editBtnEl.onclick = openHotkeyEditor;` |
| 小终端下 5 个滚动按钮(300px+)可能溢出 | 视觉上按钮被截断 | 已有 `html { overflow-x: auto }` 兜底,出现水平滚动条 |
| 「编辑」和 #scrollGroup 被移到 hotkeyList 内部后,与 hotkeyList 的 flex-wrap 行为耦合 | 快捷键很多时,它们换行位置可能不符合预期 | 用户已确认:「编辑」在最后一个快捷键的右边,5 个滚动按钮在有空隙的那行右侧;CSS 换行时它们自然落在合适位置 |
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
