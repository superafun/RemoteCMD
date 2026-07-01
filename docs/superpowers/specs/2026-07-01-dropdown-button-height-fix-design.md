# Dropdown 按钮高度不一致修复设计

## 问题

前端工具栏的 session 下拉菜单中的按钮高度比工具栏其他按钮矮约 2px。原因是 `.dropdown-menu button` CSS 规则覆盖了 `border: none; background: none;`，导致：
- 无上下边框 → 高度减少 2px
- 无背景色 → 悬停效果缺乏背景渐变，视觉扁平

## 影响范围

- **文件**: `public/styles.css`
- **选择器**: `.dropdown-menu button`（第 192-203 行）
- **无 JS 或 HTML 结构变更**

## 修复方案

采用方案 A：移除 `.dropdown-menu button` 中的 `border: none` 和 `background: none`，让 dropdown 按钮继承通用 `button` 样式。

### 具体变更

```diff
 .dropdown-menu button {
     display: block;
     width: 100%;
     text-align: left;
-    background: none;
-    border: none;
-    color: #ccc;
     padding: 6px 14px;
+    /* 继承通用 button 的 background、border、color、font-size */
 }
 .dropdown-menu button:hover {
-    background: #333;
+    background: #505050;
+    border-color: #6a6a6a;
 }
```

### 效果验证

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 高度 | ~27.6px（无边框） | ~29.6px（有边框，与 toolbar 按钮一致） |
| 背景 | `background: none` → 扁平 | 继承 `#3c3c3c`，与按钮一致 |
| 悬停 | `#333`（弱） | `#505050`（与通用按钮一致） |

### 性能影响

无。仅 CSS 属性变更，不涉及 DOM 操作、布局回流或 JS 执行。浏览器重绘成本可忽略。

## 回退方案

保留原始 CSS 的 git diff，必要时 `git revert` 即可恢复。