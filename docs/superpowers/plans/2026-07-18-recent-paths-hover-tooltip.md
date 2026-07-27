# 最近路径悬停显示完整路径 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 鼠标悬停在「最近路径」下拉的某条路径上时，通过原生 title 显示完整、未截断的路径。

**Architecture:** 仅前端改动，在 `renderRecentPathsDropdown()` 渲染每行时为整行 `item` 设置 `title = p`（完整路径）。不引入 CSS、不引入新函数、不动后端同步链路。原生 tooltip 取最内层元素属性，因此 ✕ 按钮的 `title="删除该路径"` 仍生效，路径文本区域显示完整路径。

**Tech Stack:** 原生 HTML/CSS/JS（单文件 `public/index.html`），WebSocket 已存在无需改动。

## Global Constraints

- 用户数据（含最近路径）一律走 `config.json` + WebSocket 多端同步，**禁止** localStorage（本功能不新增数据，仅展示层 tooltip，不受影响）。
- 改动保持最小：仅 1 行 JS，不新增文件、不新增 CSS 类、不动 `server.js`。
- `title` 用完整路径原文 `p`，不得截断。

---

### Task 1: 为最近路径行设置原生 title 显示完整路径

**Files:**
- Modify: `public/index.html` — `renderRecentPathsDropdown()` 内（约 1146-1153 行，`recentPaths.forEach` 循环体）

**Interfaces:**
- Consumes: 现有 `renderRecentPathsDropdown()` 中已存在的 `item`（每行根 div）、`label`（`textContent = p` 的路径文本 span）、`p`（当前路径字符串）。
- Produces: 无新接口；仅让 `item` 在 DOM 上携带 `title` 属性。

- [ ] **Step 1: 定位并修改渲染代码**

在 `public/index.html` 的 `renderRecentPathsDropdown()` 中，找到：

```js
                recentPaths.forEach(p => {
                    const item = document.createElement('div');
                    item.className = 'recent-path-item';

                    const label = document.createElement('span');
                    label.className = 'recent-path-label';
                    label.textContent = p;   // 用 textContent，避免路径特殊字符破坏 DOM
                    item.appendChild(label);
```

在 `item.appendChild(label);` 之前（或之后均可，逻辑等价）插入一行：

```js
                    item.title = p;   // 悬停整行显示完整路径（原生 tooltip）；✕ 的 title 取更内层，不冲突
```

即修改后的循环体开头为：

```js
                recentPaths.forEach(p => {
                    const item = document.createElement('div');
                    item.className = 'recent-path-item';
                    item.title = p;   // 悬停整行显示完整路径（原生 tooltip）；✕ 的 title 取更内层，不冲突

                    const label = document.createElement('span');
                    label.className = 'recent-path-label';
                    label.textContent = p;   // 用 textContent，避免路径特殊字符破坏 DOM
                    item.appendChild(label);
```

- [ ] **Step 2: 启动服务并人工验证 tooltip**

启动后端（按已有 `npm start` / 启动脚本；安卓真机走 HTTPS，桌面 Chrome 直接访问）。
打开浏览器，点顶部「最近路径」按钮展开下拉，确认若干长路径被 `text-overflow: ellipsis` 截断为前缀。

- [ ] **Step 3: 验证悬停显示完整路径**

桌面 Chrome 中，鼠标悬停某条被截断的路径（约 0.5s 后）→ 弹出系统原生 tooltip，内容为**完整路径原文**（含被截断的结尾部分）。
再悬停该行右侧的 ✕ 按钮 → 仍显示「删除该路径」（未被整行 `item.title` 覆盖，因原生 tooltip 取最内层元素）。

- [ ] **Step 4: 提交**

```bash
git add public/index.html
git commit -m "feat: 最近路径行悬停显示完整路径 (原生 title)"
```
