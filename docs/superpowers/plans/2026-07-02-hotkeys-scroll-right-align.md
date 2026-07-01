# 快捷键栏滚动按钮组右对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 hotkey-bar 底部的 5 个滚动按钮(▲上滑终端、▼下滑终端、▲上滑页面、▼下滑页面、▽到底页面)作为一个整体放在最右侧,跟随 hotkeyList 内部的 flex-wrap 行为,排不下时整组换到下一行(仍然右对齐)。

**Architecture:**
- 把 5 个滚动按钮包成 `<div id="scrollGroup">` 放进 `#hotkeysList` 末尾(不是 `#hotkeys-bar` 的独立子元素),共享 hotkeyList 内部的 `flex-wrap` 行为
- `#scrollGroup` 用 `display:flex; flex-shrink:0; margin-left:auto` 保证 5 个按钮永远在同行且右对齐
- 「编辑」按钮也移进 `#hotkeysList` 内部(在 `#scrollGroup` 之前),作为 hotkeyList 的倒数第二个子元素
- 用 JS 变量 `editBtnEl` / `scrollGroupEl` 持有引用,`renderHotkeys()` 中 `bar.innerHTML = ''` 之后 `appendChild` 回去(否则 `getElementById` 会失效)
- 5 个滚动按钮用更小的横向 padding(6px 替代 14px)+ `min-width: 0`,让它们在第二行有空间时能装下

**Tech Stack:** HTML, CSS, JavaScript (vanilla, 无框架), xterm.js v6, flex 布局

**测试方式:** 项目无测试框架(见 AGENTS.md "无测试框架"),用浏览器手动视觉验证:
- 0 / 11 / 20 个快捷键下,5 个滚动按钮的位置是否符合 spec
- 添加/删除快捷键时布局是否正确刷新
- 终端大/小尺寸切换是否影响布局

---

## 实施状态

> **本次改动已落地**,3 个 commit 完成了所有代码变更 + spec 同步:
> - `f9ade66`: DOM + JS 变更
> - `a8e959e`: CSS 变更(滚动按钮 padding 缩小)
> - `8081043`: spec 同步更新
>
> 本 plan 是规范化的步骤记录,用于追溯和参考。重新执行会创建新 commit,需要协调处理。

---

## File Structure

**修改:**
- `public/index.html` — DOM 结构(把 `#scrollGroup` 移入 `#hotkeysList`)+ JS(`editBtnEl` / `scrollGroupEl` 引用 + `renderHotkeys` 重新附加)
- `public/styles.css` — 新增 `#scrollGroup button` 规则(横向 padding 缩到 6px + min-width: 0)
- `docs/superpowers/specs/2026-07-02-hotkeys-scroll-right-align-design.md` — 设计 spec

**未修改:**
- `server.js` — 无后端变更
- `config.json` — 无配置变更(用户测试时加了 F1-F9 是临时行为)
- `package.json` — 无依赖变更

---

## Task 1: 更新 DOM 结构(public/index.html L28-L36)

**Files:**
- Modify: `public/index.html:28-36`

- [ ] **Step 1: 修改 `#hotkeys-bar` 块**

把当前 L28-L36:

```html
        <div id="hotkeys-bar">
            <div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;"></div>
            <button id="editBtn">编辑</button>
            <button id="scrollUpBtn">▲上滑终端</button>
            <button id="scrollDownBtn">▼下滑终端</button>
            <button id="scrollXtermUpBtn">▲上滑页面</button>
            <button id="scrollXtermDownBtn">▼下滑页面</button>
            <button id="scrollBottomBtn">▽到底页面</button>
        </div>
```

替换为:

```html
        <div id="hotkeys-bar">
            <div id="hotkeysList" style="display:flex;gap:0;flex-wrap:wrap;">
                <button id="editBtn">编辑</button>
                <div id="scrollGroup" style="display:flex;flex-shrink:0;margin-left:auto;">
                    <button id="scrollUpBtn">▲上滑终端</button>
                    <button id="scrollDownBtn">▼下滑终端</button>
                    <button id="scrollXtermUpBtn">▲上滑页面</button>
                    <button id="scrollXtermDownBtn">▼下滑页面</button>
                    <button id="scrollBottomBtn">▽到底页面</button>
                </div>
            </div>
        </div>
```

**为什么:**
- 「编辑」和 `#scrollGroup` 都在 `#hotkeysList` 内部,共享 flex-wrap
- `#scrollGroup` 用 `flex-shrink:0` 保持 5 个按钮整体不被压缩
- `#scrollGroup` 用 `margin-left:auto` 推到当前行右侧

- [ ] **Step 2: 验证(浏览器)**

打开 http://localhost:65433/(后端需在跑,只改前端无需重启),用 F12 检查 DOM 结构:
- `#hotkeysList` 应该有「编辑」和 `#scrollGroup` 作为子元素
- `#scrollGroup` 应该有 5 个滚动按钮作为子元素

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 5 个滚动按钮组右对齐 —— #scrollGroup 移入 #hotkeysList 内部"
```

---

## Task 2: 添加 JS 变量引用(public/index.html L62-65 之后)

**Files:**
- Modify: `public/index.html:62-65` (在 `let maxFrontendLogs = 50;` 块之后)

- [ ] **Step 1: 添加引用变量**

在 `let maxFrontendLogs = 50;` 和 `const frontendLogs = [];` 之后,添加:

```javascript
        // 保留 hotkeyList 内固定尾部元素（编辑按钮 + 滚动按钮组）的引用
        // renderHotkeys() 中 bar.innerHTML = '' 会把它们从 DOM 树摘下,getElementById 失效
        // 必须用变量持有引用才能在 renderHotkeys 末尾 appendChild 回去
        const editBtnEl = document.getElementById('editBtn');
        const scrollGroupEl = document.getElementById('scrollGroup');
```

**为什么:** `renderHotkeys()` 中 `bar.innerHTML = ''` 会把所有子元素从 DOM 树摘下,后续 `document.getElementById` 返回 null。必须用变量持有引用,才能在 `renderHotkeys` 末尾 `appendChild` 回去。

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: 保留 editBtn/scrollGroup JS 引用供 renderHotkeys 重新附加"
```

> 实际提交中此变更与 Task 1 合并为 `f9ade66`。本 plan 拆分以示清晰。

---

## Task 3: 修改 renderHotkeys 函数(public/index.html L660-L675)

**Files:**
- Modify: `public/index.html:660-675` (`renderHotkeys` 函数)

- [ ] **Step 1: 修改函数末尾**

把当前:

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
        }
```

替换为:

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
            // renderHotkeys 重跑时（添加/删除/编辑/移动快捷键）需要重新附加
            // CSS 换行时 #scrollGroup 会跟着 hotkeyList 内部 flex-wrap 走,
            // 自然落到有空隙的那一行右侧
            bar.appendChild(editBtnEl);
            bar.appendChild(scrollGroupEl);
        }
```

**为什么:** `innerHTML = ''` 之后「编辑」和 `#scrollGroup` 被摘下,需要 appendChild 回去,否则页面只剩快捷键按钮。

- [ ] **Step 2: 验证(浏览器)**

- 打开设置 → 编辑快捷键,加一个 F1,保存
- 检查 hotkeyList 仍包含「编辑」和 5 个滚动按钮
- 删掉 F1,再检查

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: renderHotkeys 末尾重新附加 editBtn 和 #scrollGroup"
```

> 实际提交中此变更与 Task 1 合并为 `f9ade66`。

---

## Task 4: 添加 #scrollGroup button CSS 规则(public/styles.css L209 之后)

**Files:**
- Modify: `public/styles.css:209` (在 `.toolbar button, #hotkeys-bar button` 规则之后)

- [ ] **Step 1: 添加新规则**

在 `.toolbar button, #hotkeys-bar button { min-width: 60px; }` 之后,添加:

```css
        /* 5 个滚动按钮的文字已经有 4 字 + 1 符号,不需要默认 14px 横向 padding */
        #scrollGroup button {
            padding-left: 6px;
            padding-right: 6px;
            min-width: 0;  /* 取消通用 min-width: 60px,允许按内容收缩 */
        }
```

**为什么:**
- 默认 `button` 有 `padding: 6px 14px`(styles.css L68-L80)
- 5 个滚动按钮的文字(▲上滑终端等)已经有 4 字 + 1 符号,不需要 14px 横向 padding
- 通用 `min-width: 60px` 是为短文字按钮(如 ▲、编辑)设计的,5 个滚动按钮用不到
- 缩窄后 5 个按钮总宽度从 ~550px 降到 ~430px,这样第二行如有空间就能装下

- [ ] **Step 2: 验证(浏览器)**

- 11 个快捷键下,第 1 行 = 全部快捷键 + 编辑,第 2 行 = 5 个滚动按钮(右侧)
- 加 9 个临时快捷键(F1-F9)到 20 个:第 1 行 = 13 个快捷键,第 2 行 = 7 个快捷键 + 编辑 + 5 个滚动按钮(右侧)

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat: 5 个滚动按钮横向 padding 缩小,允许第二行有空间时排在同行"
```

> 实际提交为 `a8e959e`。

---

## Task 5: 视觉验证清单

无测试框架,人工浏览器验证(对照 spec "关键交互矩阵" 表格)。

- [ ] **Step 1: 0 个快捷键**
- 删除所有快捷键,只留「编辑」+ 5 个滚动按钮
- 预期:全部在一行,5 个滚动按钮在最右

- [ ] **Step 2: 11 个快捷键(原配置)**
- 恢复原 11 个快捷键(Esc, Tab, ↑, ↓, →, ←, Enter, Ctrl+V, Ctrl+C, Alt+M, 刷新Path)
- 预期:第 1 行 = 11 快捷键 + 编辑(满);第 2 行 = 5 个滚动按钮(右侧)

- [ ] **Step 3: 20 个快捷键**
- 加 9 个临时快捷键(F1-F9)
- 预期:第 1 行 = 13 快捷键;第 2 行 = 7 快捷键 + 编辑 + 5 个滚动按钮(右侧)

- [ ] **Step 4: 添加/删除快捷键测试**
- 反复添加/删除快捷键,确认「编辑」和 5 个滚动按钮始终正确显示
- 确认「编辑」按钮点击仍能打开编辑器
- 确认 5 个滚动按钮的点击/长按滚动功能仍正常

- [ ] **Step 5: 终端大/小尺寸切换测试**
- 点顶栏「大/小」按钮,确认 hotkeyList 宽度跟随 xterm 变化
- 确认 5 个滚动按钮布局不破坏

- [ ] **Step 6: 清理(可选)**
- 如果加了 F1-F9 临时快捷键,可在编辑器中删除恢复原状

---

## Task 6: 同步 spec 文档(可选,如果未在 Task 1-4 之前写好)

**Files:**
- Create or Modify: `docs/superpowers/specs/2026-07-02-hotkeys-scroll-right-align-design.md`

- [ ] **Step 1: 确认 spec 包含所有变更**

spec 应包含:
- 目标(3 行:5 个滚动按钮右对齐、跟随 flex-wrap、「编辑」紧跟最后一个快捷键)
- 用户故事(5 个场景)
- 方案对比(4 个方案:A 采纳、B Grid、C 绝对定位、D 早期版本)
- 设计细节(DOM 变更、CSS 变更、JS 变更)
- 关键交互矩阵(11 个测试场景)
- 性能影响(DOM/事件/布局/内存/频率/网络)
- 风险与缓解(5 个)
- 不在范围、回退方案

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-02-hotkeys-scroll-right-align-design.md
git commit -m "docs: spec 同步代码变更"
```

> 实际提交为 `ccab64e`(初版)、`d58a581`(修正 #scrollGroup 位置)、`8081043`(同步 CSS 变更)。

---

## Self-Review

**1. Spec 覆盖:**
- ✓ DOM 变更 → Task 1
- ✓ JS 变量引用 → Task 2
- ✓ renderHotkeys 改写 → Task 3
- ✓ CSS 规则 → Task 4
- ✓ 视觉验证(11 个测试场景) → Task 5
- ✓ Spec 文档 → Task 6

**2. Placeholder 扫描:**
- 无 "TBD" / "TODO" / "fill in details"
- 所有代码块完整
- 所有 commit 命令可执行

**3. 类型/命名一致性:**
- `editBtnEl` / `scrollGroupEl` 在 Task 2 定义,Task 3 使用 → 一致
- `#scrollGroup` ID 在 Task 1 DOM、Task 4 CSS、Task 2/3 JS 都一致
- 5 个滚动按钮的 ID 在 Task 1 DOM 完整列出,Task 4 CSS 用 `#scrollGroup button` 选择器覆盖

**4. 已知偏差:**
- Task 2/3 实际合并为 Task 1 commit (`f9ade66`)。plan 拆分是为了清晰展示每一步,实际执行时可以根据代码审查合并。
- Task 5 视觉验证是手动测试,无自动化。

---

## Performance Impact

- DOM:每次 `renderHotkeys()` 多 2 次 `appendChild`,O(1)
- 事件:0 新增,0 减少(按钮的 `addEventListener` 在 JS 对象上,跟 DOM 位置解耦)
- 布局:多 1 个 flex 子项(`#scrollGroup`),CSS 计算开销可忽略
- 内存:新增 1 个 div + 2 个 const 引用,约 200 字节
- 网络:0 变化

---

## Risks

- `getElementById('editBtn')` 在 `innerHTML = ''` 之后返回 null → **缓解**:用 `editBtnEl` 引用
- 小终端下 5 个滚动按钮仍可能溢出 → **接受**:有 `html { overflow-x: auto }` 兜底
- 「编辑」和 #scrollGroup 在 hotkeyList 内部,跟 flex-wrap 行为耦合 → **接受**:用户已确认这是期望行为
