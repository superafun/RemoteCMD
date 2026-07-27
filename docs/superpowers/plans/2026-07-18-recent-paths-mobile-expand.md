# 最近路径手机端「展开看全路径」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「最近路径」下拉每行开头加一个紧凑展开按钮，手机端（无 hover）点击即可将截断的路径展开为完整换行显示；桌面仍用已有 hover title。

**Architecture:** 纯前端改动，集中在 `public/index.html`。渲染层在 `renderRecentPathsDropdown()` 循环内插入一个 `expandBtn`（行首），点击切换 `item` 的 `expanded` 类并切换 chevron 字形；CSS 层新增展开态 label 换行规则、按钮方形样式、原生媒体查询（仅触屏显示按钮）、下拉 `max-height` 滚动。无后端、无同步改动。

**Tech Stack:** 原生 HTML/CSS/JS（单文件 `public/index.html`）。原生媒体查询 `@media (hover: hover) and (pointer: fine)` 做设备定向，无 JS 检测。

## Global Constraints

- 用户数据（含最近路径）一律走 `config.json` + WebSocket 多端同步，**禁止** localStorage（本功能仅展示层，不新增数据）。
- 改动保持最小：仅 `public/index.html`，不新增文件、不动 `server.js`、不动同步链路。
- 显示方式必须原生简洁：**无浮层、无定位计算、无 JS 设备检测分支**——展开用纯 CSS 类切换，设备定向用原生媒体查询。
- 按钮必须 `stopPropagation`，点击不得触发整行复制；点路径文字仍复制、点 `✕` 仍删除。
- 按钮用 ID 选择器（`#recentPathsDropdown .recent-path-expand`）压特异性，保持 22px 正方形，避免被全局样式撑成长条。

---

### Task 1: 手机端最近路径展开按钮（渲染 + CSS）

**Files:**
- Modify: `public/index.html` — 两处：(A) `<style>` 内 `.recent-path-item` 样式区（约 35-69 行）；(B) `renderRecentPathsDropdown()` 内 `recentPaths.forEach` 循环体（约 1146-1153 行）。

**Interfaces:**
- Consumes: 现有 `renderRecentPathsDropdown()` 中已存在的 `item`（每行根 div，已带 `item.title = p`）、`label`（`.recent-path-label`，`textContent = p`）、`p`（当前路径字符串）、`del`（`.recent-path-del` 删除按钮，已有 `stopPropagation` 模式）。
- Produces: 无新接口；仅让每行 DOM 多一个 `.recent-path-expand` 按钮，且 `item` 在点击后携带/移除 `expanded` 类。

- [ ] **Step 1: 在 `<style>` 中新增按钮样式、展开态规则、媒体查询、下拉 max-height**

在 `public/index.html` 现有 `.recent-path-item { ... }` 块之后、`#recentPathsDropdown .recent-path-del { ... }` 之前，插入展开按钮与展开态样式。完整插入内容如下（紧接 `.recent-path-label { ... }` 规则之后）：

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
        #recentPathsDropdown .recent-path-item.expanded .recent-path-label {
            white-space: normal;
            word-break: break-all;
            overflow: visible;
            text-overflow: clip;
        }
        @media (hover: hover) and (pointer: fine) {
            #recentPathsDropdown .recent-path-expand { display: none; }
        }
```

- [ ] **Step 2: 给 `.dropdown-menu` 增加 max-height 与滚动**

找到现有 `.dropdown-menu {` 规则（约 70 行），在其属性块内追加两行（合并进现有规则，不新增选择器）：

```css
        .dropdown-menu {
            display: none;
            position: fixed;
            z-index: 1000;
            background: #1e1e1e;
            border: 1px solid #3a3a3a;
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            min-width: 160px;
            padding: 4px 0;
            font-size: 13px;
            color: #e0e0e0;
            max-height: 60vh;          /* 新增：手机端展开多行后不溢出视口 */
            overflow-y: auto;          /* 新增：超出则滚动 */
        }
```

- [ ] **Step 3: 在渲染循环内插入行首展开按钮**

在 `renderRecentPathsDropdown()` 的 `recentPaths.forEach(p => {` 内，于创建 `item` 之后、创建 `label` 之前，插入展开按钮，并 `appendChild` 到 `item`（保证位于行首）。修改后循环体开头为：

```js
                recentPaths.forEach(p => {
                    const item = document.createElement('div');
                    item.className = 'recent-path-item';
                    item.title = p;   // 悬停整行显示完整路径（原生 tooltip）；✕ 的 title 取更内层，不冲突

                    const expandBtn = document.createElement('button');
                    expandBtn.className = 'recent-path-expand';
                    expandBtn.type = 'button';
                    expandBtn.textContent = '▸';   // ▸ (U+25B8)
                    expandBtn.title = '展开/收起完整路径';
                    expandBtn.addEventListener('click', (e) => {
                        e.stopPropagation();                       // 避免触发整行复制
                        const on = item.classList.toggle('expanded');
                        expandBtn.textContent = on ? '▾' : '▸';    // ▾ (U+25BE)
                    });
                    item.appendChild(expandBtn);

                    const label = document.createElement('span');
                    label.className = 'recent-path-label';
                    label.textContent = p;   // 用 textContent，避免路径特殊字符破坏 DOM
                    item.appendChild(label);
```

（其余 `del` 创建与 `item` 的 click 复制逻辑保持不变。）

- [ ] **Step 4: 确认改动可用 grep 验证**

运行：`grep -n "recent-path-expand\|classList.toggle('expanded')\|max-height: 60vh" public/index.html`
预期：分别命中 Step 1 的样式定义、Step 3 的 `expandBtn` 创建与 `classList.toggle('expanded')`、Step 2 的 `max-height: 60vh`。确认无语法残留、无多余文件改动。

- [ ] **Step 5: 提交**

```bash
git add public/index.html
git commit -m "feat: 最近路径手机端展开按钮看全路径 (原生 CSS 切换 + 媒体查询)"
```

> 说明：本环境无法做真机触屏交互测试（点击展开、hover 回归属交互验证，需用户在安卓真机/桌面 Chrome 手动确认）。Step 4 的 grep 仅确认代码落地正确；交互验证不计入自动测试，由用户执行。
