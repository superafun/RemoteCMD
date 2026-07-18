# 最近路径：悬停显示完整路径

**日期：** 2026-07-18
**范围：** 前端 `public/index.html` 的 `renderRecentPathsDropdown()`，仅 1 行改动。

## 问题与背景

「最近路径」下拉里每条路径渲染在 `.recent-path-label` 上，该元素带
`overflow: hidden` + `text-overflow: ellipsis`，路径过长时被截断、只显示开头。

由于 Windows 路径开头高度相似（`C:\Users\fmy3\...`），被截断后用户无法分辨
各行究竟指向哪个目录，只能看到相似的前缀。

用户希望：**鼠标悬停在该路径上时，能显示完整、未截断的路径**，以便区分。

## 方案

采用浏览器原生 `title` 属性（零额外代码、最稳定），不使用自定义浮层。

### 改动点

在 `renderRecentPathsDropdown()`（约 `public/index.html:1136`）中，
为每行创建 `item` 后、设置 `label.textContent = p` 之后，加一行：

```js
item.title = p;   // 悬停整行显示完整路径（原生 tooltip）
```

- 绑在 `item`（整行）而非 `label`：行上大部分区域是路径文本，✕ 删除按钮已自带
  `title="删除该路径"`。原生 tooltip 取最内层元素，因此：
  - 悬停 ✕ → 显示「删除该路径」；
  - 悬停路径文本区域 → 显示完整路径。
  两者不冲突，且整行均可触发，比只绑在 label 上更宽容。
- `title` 是 DOM 属性，不受 `overflow:hidden` / `text-overflow:ellipsis` 影响，
  始终显示完整原文。

### 不做（YAGNI）

- 不引入自定义浮层 / JS tooltip（用户已选原生 `title`）。
- 不改动截断策略（如翻转 `direction` 让结尾可见）。
- 不动多端同步链路、不动后端 `server.js`。

## 行为预期

- 桌面 Chrome：鼠标悬停该行约 0.5s 后弹出系统原生 tooltip，显示完整路径。
- 可见的截断样式保持不变，仅 tooltip 提供全文。
- 移动端触摸无 hover 等价（原生 title 在触屏无效）——需求明确是「鼠标悬停」，
  桌面端满足即可。

## 验证

1. 启动服务（安卓真机走 HTTPS；桌面 Chrome 直接访问）。
2. 点顶部「最近路径」展开下拉，确认若干长路径被截断显示前缀。
3. 鼠标悬停某条被截断的路径 → 约 0.5s 后弹出原生 tooltip，内容为完整路径。
4. 悬停 ✕ 按钮 → 仍显示「删除该路径」（未被整行 title 覆盖）。
