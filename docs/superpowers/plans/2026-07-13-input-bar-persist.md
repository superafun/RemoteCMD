# 输入条：焦点移出关闭 + 草稿保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入条展开时，点其他区域（焦点移出）关闭并保留草稿；回车发送与 Esc 仅清空内容、不关闭输入条；再点开时草稿原样恢复。

**Architecture:** 纯前端改动，全部集中在 `public/index.html` 的输入条函数簇。核心机制：给 textarea 加 `blur` 监听，失焦且新焦点落在 `#inputBarWrap` 之外时调用保留式关闭；`closeInputBar` 增加 `clear` 形参区分"清空关闭"与"保留关闭"；新增 `clearInputBar` 用于发送/Esc 的"清空不关闭"。草稿天然由 textarea DOM 元素自身 `value` 留存（元素不销毁、仅隐藏），无需任何状态容器或持久化。

**Tech Stack:** 原生 JS（无框架）、xterm.js 前端、`blur`/`focus` DOM 事件、CSS flex 布局（不改）。

## Global Constraints

- **单文件前端**：改动只在 `public/index.html`，不动 `server.js`、不加 WebSocket 消息、不加协议字段。
- **所有 `ws.send` 必须走 `wsSend()`**：本功能不发任何消息，但新增代码若涉及发送必须复用 `wsSend`。
- **无测试框架 / 无 linter / 无 formatter**：本计划验证方式为前端手动验证（浏览器 + Android 真机），不写单元测试。
- **每次代码修改完成后必须立即 git commit；禁止 `git add -A`**：每个 Task 末尾 commit，只 `git add` 指定文件。
- **改动须附带性能影响分析**：本功能零新增 DOM、零轮询、零网络，新增 1 个 `blur` 监听器，性能无影响（已在 spec 论证）。
- **纯前端改动刷新即生效**：未改 `server.js`，不重启服务器；改前先确认后端在跑（`Get-NetTCPConnection -LocalPort 65433`）。
- **AGENTS.md 注意事项须同步更新**：本功能行为变更须更新注意事项 35 并随代码一并提交。
- **草稿保留范围：仅当前页面会话内**，不做跨刷新持久化（不引入 `localStorage`）。

---

### Task 1: `closeInputBar` 形参化 + 新增 `closeInputBarPreserve` 与 `clearInputBar`

**Files:**
- Modify: `public/index.html:972-981`（`closeInputBar` 函数）

**Interfaces:**
- Consumes: `autoGrow(ta)`（已存在，L983）、`sessions.get(activeId)?.focus()`（已存在）
- Produces:
  - `closeInputBar(clear = true)` —— 关闭输入条；`clear` 为真时清空 `value`
  - `closeInputBarPreserve()` —— 保留草稿地关闭（= `closeInputBar(false)`）
  - `clearInputBar()` —— 清空 `value` + 重算高度，**不移动焦点**、保持展开

- [ ] **Step 1: 改写 `closeInputBar` 并新增两个辅助函数**

将 `public/index.html` 的 `closeInputBar`（L972-981）整体替换为：

```js
        function closeInputBar(clear = true) {
            // 先交还终端焦点，避免 textarea 隐藏瞬间失焦导致移动端软键盘收回
            // （与其他快捷键按钮一致：点完后焦点仍在终端输入框，键盘不收）
            sessions.get(activeId)?.focus();
            inputBarWrap.style.display = 'none';
            inputBarBtn.style.display = '';          // 恢复输入条按钮
            hotkeysListEl.style.display = 'flex';    // 恢复快捷键栏
            if (clear) { inputBarText.value = ''; }
            inputBarText.style.height = 'auto';
        }
        // 保留草稿地关闭（焦点移出用）：不清空内容，下次点开仍可见
        function closeInputBarPreserve() { closeInputBar(false); }
        // 清空内容但保持展开、焦点留在输入框（Esc / 发送后用）
        function clearInputBar() {
            inputBarText.value = '';
            inputBarText.style.height = 'auto';
            autoGrow(inputBarText);
            // 不移动焦点：桌面端光标留在输入框；移动端软键盘不收回，可连续输入
        }
```

- [ ] **Step 2: 手动验证（浏览器）**

1. 确认后端在跑：`Get-NetTCPConnection -LocalPort 65433`（无输出=未跑则 `npm start`）。
2. 浏览器开 `http://localhost:65433`，刷新页面（前端改动刷新即生效）。
3. 点「输入条」展开，输入 `hello`，点「换行」按钮（空内容路径）→ 输入条关闭。
4. 再点「输入条」→ 预期此时输入框为**空**（因为「换行」空内容走了 `closeInputBar()` 默认清空）—— 确认改动未破坏既有清空行为。

预期：既有「换行」空内容退出流程正常，输入框清空；无 JS 报错（F12 Console 无红字）。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "refactor: closeInputBar 加 clear 形参，新增 preserve/clear 辅助函数"
```

---

### Task 2: `openInputBar` 停止清空 value（保留草稿）

**Files:**
- Modify: `public/index.html:964-971`（`openInputBar` 函数）

**Interfaces:**
- Consumes: `autoGrow(inputBarText)`（已存在）、`closeInputBarPreserve()` / `clearInputBar()`（Task 1 产出）
- Produces: `openInputBar()` 行为变更——打开时不再清空，保留上次 `value`

- [ ] **Step 1: 删除 `openInputBar` 中的清空行**

将 `openInputBar`（L964-971）替换为（删掉 `inputBarText.value = '';` 那一行）：

```js
        function openInputBar() {
            inputBarBtn.style.display = 'none';      // 展开时连同输入条按钮一起隐藏
            hotkeysListEl.style.display = 'none';    // 展开时隐藏快捷键栏
            inputBarWrap.style.display = 'flex';     // 输入条独占整行
            // 不再清空 value：保留上次未发送草稿，autoGrow 按现有内容重算高度
            autoGrow(inputBarText);
            inputBarText.focus();
        }
```

- [ ] **Step 2: 手动验证（浏览器 + 草稿留存）**

1. 刷新页面。点「输入条」展开，输入 `草稿ABC`，鼠标点终端区域（焦点移出 → 此时 Task 3 尚未实现，所以现在点终端**不会**关闭；本步仅验证打开时不再清空）。
2. 直接再点「输入条」按钮关闭再打开（toggle 路径当前仍走 `closeInputBar` 清空，属既有行为，暂不验证草稿）—— 本步重点是：打开输入框后，若 value 未被清空过，输入内容不应被抹掉。
3. 更直接的验证：在控制台执行 `inputBarText.value = 'TEST'; openInputBar();` → 预期输入框显示 `TEST` 且高度随内容撑开，而非空白。

预期：打开输入框后 `value` 不被清空；若此前有值则原样显示。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "fix: openInputBar 不再清空草稿，打开时保留上次内容"
```

---

### Task 3: 新增 textarea `blur` 监听（焦点移出关闭 + 保留）

**Files:**
- Modify: `public/index.html:1014-1018`（在现有 `keydown` 监听之后追加 `blur` 监听）

**Interfaces:**
- Consumes: `inputBarWrap`（DOM 句柄，已存在）、`closeInputBarPreserve()`（Task 1 产出）
- Produces: `blur` 事件监听器——焦点移出输入条整体时关闭并保留草稿

- [ ] **Step 1: 在 `keydown` 监听后追加 `blur` 监听**

将 `public/index.html` L1014-1018（现有两个 `addEventListener`）之后，追加：

```js
        inputBarText.addEventListener('blur', (e) => {
            if (inputBarWrap.style.display !== 'flex') return;   // 已关闭则忽略，防止程序化 close 后的二次触发
            const r = e.relatedTarget;
            if (r && inputBarWrap.contains(r)) return;            // 焦点仍在输入条内（如换行按钮），不关闭
            closeInputBarPreserve();                             // 点外部/终端：关闭但保留草稿
        });
```

- [ ] **Step 2: 手动验证（焦点移出关闭 + 草稿保留）**

1. 刷新页面。点「输入条」展开，输入 `保留测试`。
2. 鼠标点击终端区域（焦点移出）→ 预期：输入条**关闭**。
3. 再点「输入条」按钮展开 → 预期：输入框显示 `保留测试`，高度正确（草稿原样恢复）。
4. 展开输入条，输入 `xyz`，点击「换行」按钮（有内容）→ 预期：输入条**不关闭**，在光标处插入换行（验证 `contains` 守卫不误关）。
5. 展开输入条，点击「换行」按钮（空内容）→ 预期：输入条关闭（既有行为）。

预期：焦点移出关闭并保留草稿；点「换行」按钮不误关。Console 无报错。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 输入条焦点移出关闭并保留草稿（blur 监听 + relatedTarget 守卫）"
```

---

### Task 4: `sendInputBar` 与 Esc 改为仅清空不关闭

**Files:**
- Modify: `public/index.html:1001-1018`（`sendInputBar` 与 `keydown` 监听）

**Interfaces:**
- Consumes: `clearInputBar()`（Task 1 产出）、`addFrontendLog()` / `wsSend()` / `activeId` / `TYPING_DELAY` / `sleep()`（均已存在）
- Produces: 回车发送、Esc 走 `clearInputBar()`——清空内容但保持展开

- [ ] **Step 1: `sendInputBar` 中 `closeInputBar()` 改为 `clearInputBar()`**

将 `public/index.html` L1006 的 `closeInputBar();` 改为 `clearInputBar();`，即 `sendInputBar`（L1001-1013）变为：

```js
        async function sendInputBar() {
            const t = inputBarText.value.replace(/\n+$/, '');   // 去末尾换行，避免多发空行
            if (!t) { return; }                                  // 空内容：不发送、不关闭（回车发送语义）
            const targetId = activeId;                            // 捕获目标会话，防止发送途中切换会话串台
            const seq = t.replace(/\n/g, '\r') + '\r';           // \n→\r 并补末尾回车
            clearInputBar();                                      // 清空内容但保持展开，焦点仍在输入框
            addFrontendLog('输入条发送: ' + t, 'out');
            for (const ch of seq) {
                if (!targetId) break;                             // 捕获时无活动会话（activeId 为 null）则不发送
                wsSend({ type: 'input', id: targetId, data: ch });
                await sleep(TYPING_DELAY);
            }
        }
```

- [ ] **Step 2: `keydown` 监听中 Esc 改为 `clearInputBar()`**

将 `public/index.html` L1016 的 `closeInputBar()` 改为 `clearInputBar()`，即 `keydown` 监听（L1015-1018）变为：

```js
        inputBarText.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); clearInputBar(); }
            else if (e.key === 'Enter') { e.preventDefault(); sendInputBar(); }  // 回车=发送（与换行按钮对调）
        });
```

- [ ] **Step 3: 手动验证（发送/Esc 仅清空不关闭）**

1. 刷新页面。点「输入条」展开，输入 `dir`，按回车发送 → 预期：内容发送到终端（终端出现 `dir` 输出），**输入条不关闭、内容清空**，焦点仍在输入框，可立即继续输入。
2. 输入 `cls`，按 Esc → 预期：输入条**不关闭、内容清空**，焦点仍在输入框。
3. 发送后点终端区域 → 预期：输入条关闭（此时 value 为空，无草稿可保留）。
4. Android 真机（https）重复步骤 1-3：发送/Esc 后**软键盘不收回**（保持展开），符合预期。

预期：回车发送、Esc 均仅清空不关闭；焦点留框内；Console 无报错。

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: 回车发送与 Esc 改为仅清空不关闭（clearInputBar）"
```

---

### Task 5: 更新 AGENTS.md 注意事项 35 并提交

**Files:**
- Modify: `AGENTS.md`（注意事项 35，当前描述输入条行为的段落）

**Interfaces:**
- Consumes: 全部已实现行为（Task 1-4）
- Produces: AGENTS.md 注意事项 35 与最终实现一致，可供后续维护

- [ ] **Step 1: 更新注意事项 35 文案**

在注意事项 35 现有文本中，将关于"收起/再点按钮/Esc 恢复"及关闭语义的描述，补齐为：

> 展开时 `#inputBarBtn`（输入条入口按钮）与 `#hotkeysList`（编辑/滚动按钮）均 `display:none` 隐藏、输入条铺满整行中间——最左是「发按键」、最右是「换行」、两者之间的全部空间都是输入条（`#inputBarWrap` `flex:1 1 0` 填满整行、`#inputBarText` `flex:1` 占满中间、`gap:0` 使输入框右边缘紧贴「换行」按钮，无空隙）；收起/再点按钮恢复。`Esc` **仅清空内容、不关闭**输入条（光标留在框内，可继续输入）。**焦点移出**：输入框展开时点击终端/页面空白等使 textarea 失焦，触发 `blur` 监听（`relatedTarget` 在 `#inputBarWrap` 外才关闭）关闭输入条并**保留草稿**，下次点开原样恢复；点击「换行」按钮（在容器内）不误关。`openInputBar()` 不再清空 `value`，草稿由 textarea 自身留存（仅当前会话，不跨刷新）。`sendInputBar()` 回车发送后**清空内容但保持展开**（便于连续输入），走 `clearInputBar()`；`closeInputBar(clear=true)` 默认清空关闭（「换行」空内容退出用），`closeInputBarPreserve()` 保留关闭（焦点移出用）。`sendInputBar()` 直接调 `wsSend({type:'input', id: targetId, data: ch})`（`targetId` 发送前捕获），**不动 `server.js`、不加 WebSocket 消息**。

（其余原有说明——逐字符发送、autoGrow、移动端软键盘交还焦点等——保持不变，仅合并上述关闭/保留语义更新。）

- [ ] **Step 2: 整体回归验证**

1. 刷新页面，完整走查 spec 验收标准 1-6：
   - 焦点移出关闭→再开恢复草稿 ✓
   - 回车发送→不关闭、清空、可续输 ✓
   - Esc→不关闭、清空 ✓
   - 「换行」有内容插入/空内容退出 ✓
   - 桌面 + Android 真机 ✓
2. 确认无任何功能回退（快捷键栏、发按键面板、滚动按钮在输入条展开时正确隐藏/恢复）。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: 更新注意事项 35 输入条焦点移出保留/发送 Esc 仅清空不关闭"
```

---

## Self-Review

**1. Spec coverage:**
- 焦点移出关闭+保留 → Task 3（blur 监听）✓
- openInputBar 保留草稿 → Task 2 ✓
- closeInputBar clear 形参 / preserve / clearInputBar → Task 1 ✓
- 回车发送仅清空不关闭 → Task 4 ✓
- Esc 仅清空不关闭 → Task 4 ✓
- 「换行」空内容退出（清空关闭）→ Task 1 保留默认行为 ✓
- AGENTS.md 同步 → Task 5 ✓
- 性能/范围（纯前端、会话内、无持久化）→ Global Constraints + Task 1 论证 ✓

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤均给出完整代码块；验证步骤给出明确操作与预期，无"适当处理"类空话。

**3. Type/命名一致性：** `closeInputBar(clear)`、`closeInputBarPreserve()`、`clearInputBar()` 三者在 Task 1 定义、Task 3/4 消费，签名与命名全程一致；`openInputBar` 无参、与既有调用方 `toggleInputBar` 兼容。无前后不一致。

无问题，计划完整。
