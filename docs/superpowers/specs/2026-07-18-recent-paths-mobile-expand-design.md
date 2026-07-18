# 最近路径：手机端「展开看全路径」

**日期：** 2026-07-18
**范围：** 前端 `public/index.html`（`renderRecentPathsDropdown()` 渲染 + 行内 CSS）。纯前端，无后端改动。

## 背景

「最近路径」下拉每条路径用 `text-overflow: ellipsis` 单行截断，路径开头高度相似，
用户无法区分。电脑端已用原生 `title`（鼠标悬停显示完整路径）解决。

但触屏设备没有 hover：手机端下拉宽度常被设为 ~200px，路径截得更狠，且无法悬停查看。
点击行 = 复制，因此「看全路径」需要一种不与复制冲突的触发方式。

用户选定：每行**开头**加一个展开按钮，点它显示完整路径；显示方式尽量简洁、尽量原生。

## 方案

在每行开头加一个紧凑正方形展开按钮（chevron `▸`）。点击切换该行 `.expanded` 类，
路径 label 由单行 ellipsis 截断变为自动换行显示全文。点路径文字仍 = 复制，点 `✕` 仍 = 删除。

### 1. 渲染（DOM）

在 `renderRecentPathsDropdown()` 的 `recentPaths.forEach` 循环内，于创建 `item` 之后、
`label` 之前，插入一个展开按钮 `expandBtn`：

```js
const expandBtn = document.createElement('button');
expandBtn.className = 'recent-path-expand';
expandBtn.type = 'button';
expandBtn.textContent = '▸';                 // ▸ (U+25B8)，展开态变 ▾
expandBtn.title = '展开/收起完整路径';
expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();                       // 避免触发整行复制
    const on = item.classList.toggle('expanded');
    expandBtn.textContent = on ? '▾' : '▸';    // ▾ (U+25BE)
});
item.appendChild(expandBtn);
```

（注意：按钮需在 `label` 之前 `appendChild`，以保证它位于行首。）

### 2. 显示（纯 CSS，无浮层/无定位）

切换发生在 `item` 上：新增 CSS 规则控制展开态下路径 label 的换行——

```css
#recentPathsDropdown .recent-path-item.expanded .recent-path-label {
    white-space: normal;
    word-break: break-all;
    overflow: visible;
    text-overflow: clip;
}
```

基础 `.recent-path-label` 维持现有 `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`。

### 3. 按钮样式（防长条，复用现有规范）

用 ID 选择器压特异性，给 22px 正方形、字形居中，复用 `.recent-path-del` 同款紧凑方形风格：

```css
#recentPathsDropdown .recent-path-expand {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    min-width: 0;
    padding: 0;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #999;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    border-radius: 4px;
}
#recentPathsDropdown .recent-path-expand:hover { background: rgba(255, 255, 255, 0.12); color: #e0e0e0; }
```

### 4. 设备定向（原生媒体查询，无 UA 嗅探、无 JS 分支）

按钮始终渲染在 DOM；仅在有 hover 的精确指针设备（桌面鼠标）上隐藏，触屏（`hover: none`）
自动显示：

```css
@media (hover: hover) and (pointer: fine) {
    #recentPathsDropdown .recent-path-expand { display: none; }
}
```

这样桌面仍用已有 hover title，手机用展开按钮，两端都覆盖，且不需要任何 JS 设备检测。

### 5. 下拉溢出保护

`.dropdown-menu` 增加最大高度与滚动，手机端展开多行后不超出视口（桌面列表短无影响）：

```css
.dropdown-menu {
    max-height: 60vh;
    overflow-y: auto;
}
```

（合并进现有 `.dropdown-menu` 规则，不新增选择器。）

## 行为预期

- 桌面（鼠标）：展开按钮隐藏，悬停行仍用原生 title 看全路径（已有行为不变）。
- 手机（触屏）：每行行首显示 `▸` 按钮；点它 → 该行路径完整换行显示，`▸` 变 `▾`；
  再点收起。点路径文字仍复制，点 `✕` 仍删除。
- 多端一致性：展开按钮的显示/隐藏由 CSS 媒体查询决定，与后端同步无关。

## 不做（YAGNI）

- 不引入长按手势（pointerdown 计时）、不引入自定义 popover/浮层。
- 不做 UA 嗅探、不写 JS 设备检测分支。
- 不动后端 `server.js`、不动多端同步链路。

## 验证（真机为主）

1. 安卓真机（HTTPS）打开，「最近路径」下拉每行行首出现 `▸`。
2. 点 `▸` → 该行路径完整换行显示、按钮变 `▾`；再点收起。
3. 点路径文字 → 仍「已复制」；点 `✕` → 仍删除该行；两者互不干扰。
4. 桌面 Chrome：展开按钮不可见，悬停行仍弹出原生 title 完整路径（回归确认）。
5. 长路径多条展开后，下拉整体可在 60vh 内滚动，不溢出视口。
