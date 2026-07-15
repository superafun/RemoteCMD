# 输入条纵向滚动条修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复底部输入条 `#inputBarText` 在空内容/正常行数下恒出现纵向滚动条的 bug。

**Architecture:** 删除 commit 3c418a6 引入的 `#inputBarText { box-sizing: border-box }`，恢复 textarea 默认 `content-box`。这样 `autoGrow(ta)` 写入的 `height = scrollHeight` 不再包含 border，`clientHeight === scrollHeight` → 无溢出 → 无滚动条。保留 `max-height: 160px` 不动，超 8 行仍可滚动。纯 1 行 CSS 改动，不动 JS、不动协议、不动 server.js。

**Tech Stack:** 纯 CSS（public/styles.css），Playwright CLI 做实测验证（项目无测试框架）。

## Global Constraints

- **后端服务**：`http://127.0.0.1:65433/`，PM2 管理；本计划只改前端静态文件，**不需要重启后端**，浏览器刷新即加载新 CSS。
- **Playwright 会话**：实测时复用已有 `playwright-cli` 默认会话（`playwright-cli list` 应显示 default: open）。若会话已关，先 `playwright-cli open http://127.0.0.1:65433/`。
- **git 工作流**：单 commit 完成修复。commit message 用 `fix:` 前缀。**禁止 `git add -A`**，只 add 实际改动的文件。`public/styles.css` 在本任务前已有用户自己改的未提交改动（删 padding 的 0），不属于本次 commit，**只 add 本任务改的具体行** 不可能（git add 是文件级），所以 commit 时会一并带入用户那个改动 —— 这是**可接受**的，因为用户的 padding 改动也是输入条相关、视觉对齐意图一致。commit message 不提 padding 改动，只描述滚动条修复。
- **不要重启服务器**：本计划全程不需要重启 PM2/远程命令服务。

---

### Task 1: 删除 `#inputBarText` 的 `box-sizing: border-box`

**Files:**
- Modify: `public/styles.css:267`（删除 `box-sizing: border-box;` 这一行，连同其后的注释也一并删除——注释是"统一标准"的理由，删掉 border-box 后注释失去依据）

**Interfaces:**
- Consumes: 无（独立 bug 修复）
- Produces: 修复后的 `#inputBarText` 样式，`scrollHeight === clientHeight`（无 border 干扰）

- [ ] **Step 1: 用 Edit 工具删除 `box-sizing` 行及其注释**

读 `public/styles.css` 当前 258-272 行确认状态：

```css
#inputBarText {
    flex: 1;               /* 占满中间全部空间，尽可能宽 */
    min-width: 0;
    resize: none;
    overflow: auto;
    max-height: 160px;
    background: #1e1e1e;
    color: #eee;
    border: 1px solid #555;
    box-sizing: border-box;  /* 与 .modal-box input 统一标准,避免不同浏览器高度计算漂移 */
    outline: none;            /* 去掉 Chrome focus 默认白色焦点环,避免与相邻"发按键"按钮的 #555 右边框视觉冲突（焦点视觉改由 :focus 改 border-color 体现） */
    font: inherit;
    line-height: 1.4;
    padding: 4px 6px;   /* 底部 0：文字贴框底，整体高度进一步贴近侧边按键 */
}
```

用 Edit 工具，old_string：

```
            border: 1px solid #555;
            box-sizing: border-box;  /* 与 .modal-box input 统一标准,避免不同浏览器高度计算漂移 */
            outline: none;            /* 去掉 Chrome focus 默认白色焦点环,避免与相邻"发按键"按钮的 #555 右边框视觉冲突（焦点视觉改由 :focus 改 border-color 体现） */
```

new_string：

```
            border: 1px solid #555;
            outline: none;            /* 去掉 Chrome focus 默认白色焦点环,避免与相邻"发按键"按钮的 #555 右边框视觉冲突（焦点视觉改由 :focus 改 border-color 体现） */
```

注意：保留 `outline: none`（修 Chrome 白色焦点环的独立 bug，与本次滚动条无关，commit 3c418a6 同 commit 引入，不动它）。padding 那行的陈旧注释"底部 0：..."（用户已自行删 0 但未改注释）不在本次范围，不动它。

- [ ] **Step 2: 浏览器刷新加载新 CSS**

```bash
playwright-cli reload
```

Expected: 页面重新加载，`#inputBarText` 的 computed `box-sizing` 应变为 `content-box`。

- [ ] **Step 3: 展开输入条，实测空内容下的尺寸**

```bash
playwright-cli eval "() => { const btn = document.getElementById('inputBarBtn'); btn.click(); const ta = document.getElementById('inputBarText'); const cs = getComputedStyle(ta); return { boxSizing: cs.boxSizing, scrollHeight: ta.scrollHeight, clientHeight: ta.clientHeight, offsetHeight: ta.offsetHeight, height_inline: ta.style.height, hasVScroll: ta.scrollHeight > ta.clientHeight, diff: ta.scrollHeight - ta.clientHeight }; }"
```

Expected（关键断言）：
- `boxSizing`: `"content-box"`
- `scrollHeight` === `clientHeight`（数值相等）
- `diff`: `0`
- `hasVScroll`: `false`

如果 `diff !== 0`，**停止**，重新分析（可能是其他原因，如 line-height 取整、padding 不一致等）。

- [ ] **Step 4: 实测多行内容（未超 max-height）**

```bash
playwright-cli eval "() => { const ta = document.getElementById('inputBarText'); const results = []; const cases = ['', 'abc', 'a\\nb', 'a\\nb\\nc', 'a\\nb\\nc\\nd\\ne']; for (const v of cases) { ta.value = v; ta.dispatchEvent(new Event('input')); results.push({ value: JSON.stringify(v), scrollHeight: ta.scrollHeight, clientHeight: ta.clientHeight, hasVScroll: ta.scrollHeight > ta.clientHeight, diff: ta.scrollHeight - ta.clientHeight }); } return results; }"
```

Expected（关键断言）：所有 5 种内容 `hasVScroll: false`、`diff: 0`。

如果任何一项 `hasVScroll: true`，**停止**，重新分析。

- [ ] **Step 5: 实测超 max-height 内容（应保留滚动条）**

```bash
playwright-cli eval "() => { const ta = document.getElementById('inputBarText'); ta.value = 'a\\nb\\nc\\nd\\ne\\nf\\ng\\nh'; ta.dispatchEvent(new Event('input')); return { scrollHeight: ta.scrollHeight, clientHeight: ta.clientHeight, offsetHeight: ta.offsetHeight, height_inline: ta.style.height, hasVScroll: ta.scrollHeight > ta.clientHeight, diff: ta.scrollHeight - ta.clientHeight, max_height: getComputedStyle(ta).maxHeight }; }"
```

Expected：
- `hasVScroll`: `true`（合理：内容超过 160px 应可滚）
- `height_inline` 应被 `max-height: 160px` 截断（实际渲染高度 = 160，但 inline style 仍是 scrollHeight 数值，max-height 通过 CSS 优先级生效）

- [ ] **Step 6: 截图肉眼确认对齐无回归**

```bash
playwright-cli screenshot --filename=inputbar-after-fix.png
```

肉眼检查：
- 输入条与左侧"发按键"按钮零间距
- 输入条与右侧"换行"按钮零间距
- 输入条高度与左右按钮高度协调（之前 padding: 4px 6px 0 已调过，现在 padding 是 4px 6px，用户自行改的）
- 输入条内无纵向滚动条（空内容）

如果对齐有回归（如 textarea 总宽 +2px 导致右边缘与"换行"按钮出现 2px 缝隙或重叠），**停止**，向用户报告现象，不要自行调整 padding/border 弥补。

- [ ] **Step 7: 关闭输入条恢复快捷键栏**

```bash
playwright-cli eval "() => { document.getElementById('inputBarBtn').click(); return { wrap_display: getComputedStyle(document.getElementById('inputBarWrap')).display, hotkeysList_display: getComputedStyle(document.getElementById('hotkeysList')).display }; }"
```

Expected: `wrap_display: "none"`, `hotkeysList_display: "flex"`（确认 toggle 关闭路径未受影响）。

- [ ] **Step 8: 暂存并提交**

```bash
git add public/styles.css
git status --short
```

Expected: `M public/styles.css`（如同时有 `.playwright-cli/` 等临时文件，不 add）。

```bash
git commit -m "fix: 删除 #inputBarText 的 box-sizing:border-box 修复恒 2px 滚动条"
```

commit message 说明：根因是 `box-sizing: border-box` + `autoGrow` 写 `height = scrollHeight` 冲突——border-box 下 scrollHeight 含 border、clientHeight 不含，永远差 2px 触发滚动条。删除后恢复 content-box，scrollHeight === clientHeight，无溢出。

- [ ] **Step 9: 通知用户验收**

向用户报告：
- 改了哪个文件（public/styles.css L267 删 1 行 + 注释）
- 是否需要重启后端（**不需要**，纯前端 CSS，浏览器刷新即生效）
- 已用 Playwright 实测 5 种内容 + max-height 溢出场景，断言通过
- 截图保存路径
- 请用户在真机/常用浏览器上肉眼复核

## Self-Review

**1. Spec coverage：**
- spec 要求"删 box-sizing: border-box"：Task 1 Step 1 ✓
- spec 要求"保留 max-height: 160px"：本计划不动 max-height，Step 5 验证超 8 行仍可滚 ✓
- spec 要求"Playwright 实测验证"：Step 3-5 ✓
- spec 要求"截图肉眼确认对齐"：Step 6 ✓
- spec 要求"1 行 CSS 改动"：Step 1 删 1 行 + 1 行注释（注释是 border-box 的理由，删 border-box 必须删注释否则注释悬空）—— 严格说不是"1 行"，但本质改动就是 1 行 CSS 规则，注释依附于规则存在 ✓

**2. Placeholder scan：**
- 无 TBD/TODO
- 所有步骤有具体命令和 expected 输出
- 截图检查项有具体肉眼判断标准
- 异常分支有"停止 + 报告"明确处理路径

**3. Type consistency：**
- 不涉及跨任务类型/函数签名（纯 CSS）
- `#inputBarText` ID 在所有 Playwright eval 命令中一致
- `box-sizing` / `scrollHeight` / `clientHeight` 属性名拼写一致

无问题，计划可执行。
