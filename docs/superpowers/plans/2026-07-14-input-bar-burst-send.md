# 输入条长命令报错修复（整段发送 + 回车分离）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把底部输入条 `sendInputBar()` 从"逐字符发送"改为"正文整段一次性发送 + 末尾回车分离延迟 300ms 单独发"，修复长命令在 TUI 中报错 `windows ctrl+v may block large input for large paste...` 的问题。

**Architecture:** 仅改前端 `public/index.html` 的 `sendInputBar()` 及相邻常量区：正文（已 `\n`→`\r`）作为一条 `wsSend({type:'input'})` 发出（与右键粘贴同路径），停顿 `ENTER_DELAY=300ms` 后单独发一条 `\r` 消息模拟手动回车。不动 `server.js`、不加 WebSocket 协议、不重启服务器。同步更新 `AGENTS.md` 注意事项 35。

**Tech Stack:** 纯前端原生 JS（无框架、无打包），xterm.js v6 + node-pty 后端（本次不改动）。

## Global Constraints

- 本项目**无测试框架、无 linter、无 formatter**（来源 `AGENTS.md` 构建/运行/依赖）。故本计划无自动化单测，验证以"浏览器控制台 + Android 真机"手动为准（用户偏好用安卓真机测试）。
- 改动仅前端：测试前用 `Get-NetTCPConnection -LocalPort 65433` 确认后端在跑则用现成服务，**只改前端不重启服务器**（`AGENTS.md` 开发工作流）。
- 每次代码修改完成后必须立即 `git commit`，禁止 `git add -A`（来源 `AGENTS.md` Git 工作流）；单步回退用 `git revert HEAD`。
- `wsSend(obj)` 是所有 WebSocket 发送统一入口，内置 `readyState===1` 检查 + try-catch，禁止直接调 `ws.send()`（来源 `AGENTS.md` 前端关键辅助函数）。
- 换行归一保留：`\n`→`\r`，因终端回车键产生 `\r`（0x0D）而非 `\n`，TUI raw 模式只认 `\r` 作换行/确认信号。
- ENTER_DELAY 固定 300（ms）。

---

### Task 1: 常量区改造（TYPING_DELAY → ENTER_DELAY，保留 sleep）

**Files:**
- Modify: `public/index.html:996-999`（紧邻 `autoGrow` 之后的常量与 `sleep` 辅助）

**Interfaces:**
- Consumes: 既有 `sleep(ms)` 辅助（本任务保留，供 Task 2 的回车停顿使用）；既有 `wsSend` / `activeId`（Task 2 使用，本任务不碰）。
- Produces: 常量 `ENTER_DELAY`（数值，单位 ms，默认 300），供 Task 2 的 `await sleep(ENTER_DELAY)` 引用。删除 `TYPING_DELAY`（逐字符循环移除后无引用）。

- [ ] **Step 1: 替换常量定义与注释**

将 `public/index.html:996-997`：

```js
        // 逐字符发送时每个字符之间的延时（ms），模拟真人敲键节奏；如需更慢/更快改这里
        const TYPING_DELAY = 15;
```

替换为：

```js
        // 正文发完后、单独发回车前的停顿（ms），模拟手动按 Enter 前的手感
        const ENTER_DELAY = 300;
```

保留 `public/index.html:999` 的 `function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }` 不变。

- [ ] **Step 2: 浏览器加载校验（无报错即过关）**

刷新网页（F12 打开控制台），确认无红字报错；`TYPING_DELAY` 已不存在于页面（可搜索确认）。本步骤仅验证符号替换不破坏加载，发送逻辑尚未改（Task 2 完成才生效）。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "refactor: 输入条常量 TYPING_DELAY 改为 ENTER_DELAY（回车停顿）"
```

---

### Task 2: 改写 sendInputBar 为整段发送 + 回车分离

**Files:**
- Modify: `public/index.html:1010-1022`（`sendInputBar` 函数体）

**Interfaces:**
- Consumes: `ENTER_DELAY`（Task 1 产出）、`sleep(ms)`（Task 1 保留）、`activeId`（全局当前会话 id）、`wsSend(obj)`（全局统一发送入口）、`clearInputBar()`（既有，清空内容保持展开）、`addFrontendLog(msg, dir)`（既有日志）。
- Produces: 新的 `sendInputBar()` 行为——整段正文一条 `wsSend` + 延迟后单独一条 `\r` `wsSend`。`insertNewline()` / 底部快捷键 / 发按键面板 / 右键粘贴均不依赖 `sendInputBar` 内部细节，不受影响。

- [ ] **Step 1: 替换 sendInputBar 函数体**

将 `public/index.html:1010-1022`：

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

替换为：

```js
        async function sendInputBar() {
            const t = inputBarText.value.replace(/\n+$/, '');   // 去末尾换行，避免多发空行
            if (!t) { return; }                                  // 空内容：不发送、不关闭（回车发送语义）
            const targetId = activeId;                            // 捕获目标会话，防止发送途中切换会话串台
            const textSeq = t.replace(/\n/g, '\r');              // 正文内容，\n→\r，不含末尾回车
            clearInputBar();                                      // 清空内容但保持展开，焦点仍在输入框
            addFrontendLog('输入条发送: ' + t, 'out');
            if (!targetId) return;                               // 捕获时无活动会话则不发送
            wsSend({ type: 'input', id: targetId, data: textSeq });  // 整段正文一次性发出
            await sleep(ENTER_DELAY);                            // 停顿，模拟手动按 Enter 前的手感
            wsSend({ type: 'input', id: targetId, data: '\r' });     // 单独发回车 = 确认/执行
        }
```

- [ ] **Step 2: 浏览器控制台校验（无报错 + 日志正确）**

刷新网页（F12 控制台），确认无红字报错；在输入框输入任意文字按回车，日志（`设置`→`日志` 或前端日志）应出现 `输入条发送: <内容>` 一条记录（不再是逐字符多条）。本步骤验证发送逻辑不破坏加载；完整行为验收见 Task 4。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "fix: 输入条改为正文整段发送 + 回车分离(ENTER_DELAY=300ms)"
```

---

### Task 3: 更新 AGENTS.md 注意事项 35

**Files:**
- Modify: `AGENTS.md:303`（主注 "+ 回车发送" 段）、`AGENTS.md:305`（"逐字符发送" 子注）

**Interfaces:**
- Consumes: 实现后的 `sendInputBar` 行为（Task 1 + Task 2 产出）、`ENTER_DELAY=300` 常量。
- Produces: 与代码一致的注意事项文档，供后续维护参考。

- [ ] **Step 1: 修改 AGENTS.md:303 主注中发送描述**

将 `AGENTS.md:303` 段内这句：

```
回车（Enter）即「发送」：在 textarea 内按 Enter 把内容发到当前 xterm——先 replace(/\n+$/,'') 去末尾换行，空则仅不发送（不关闭），否则拼接 \n→\r 并补末尾 \r 的序列，**逐字符各发一条独立 input 消息**（字符间 await sleep(TYPING_DELAY)，固定 15ms 模拟真人敲键），随后清空内容并保持展开。
```

替换为：

```
回车（Enter）即「发送」：在 textarea 内按 Enter 把内容发到当前 xterm——先 replace(/\n+$/,'') 去末尾换行，空则仅不发送（不关闭），否则把 \n→\r 的序列**整段作为一条 input 消息一次性发出**（与右键粘贴同路径），停顿 ENTER_DELAY(300ms) 后**单独发一条 \r input 消息**模拟手动回车=确认/执行，随后清空内容并保持展开。
```

并将同段这句：

```
sendInputBar() 直接调 wsSend({type:'input', id: targetId, data: ch})（targetId 发送前捕获）
```

替换为：

```
sendInputBar() 直接调 wsSend({type:'input', id: targetId, data: textSeq}) 与 wsSend({type:'input', id: targetId, data: '\r'})（targetId 发送前捕获）
```

- [ ] **Step 2: 重写 AGENTS.md:305 子注**

将 `AGENTS.md:305` 整条子注：

```
- **逐字符发送（2026-07-13 引入）**：`sendInputBar()` 不再把整段文本拼成一条消息一次性发出，而是拼接 `文本.replace(/\n/g,'\r') + '\r'` 序列后，**逐字符各发一条独立 `input` 消息**，字符间 `await sleep(TYPING_DELAY)`（固定 15ms 常量，模拟真人敲键）。原因：TUI 把"整段一次性灌入"当粘贴/缓冲文本，`\r` 被解释成字段内换行；而底部 Enter 快捷键是单独一条 `\r` 消息，TUI 当作真实按键=确认。逐字符发送后 TUI 把每字符当独立按键，`\r` 回到确认语义，与 Enter 快捷键一致。发送前捕获 `targetId = activeId`，发送途中切换会话不串台；循环中 `if (!targetId) break` 仅保护「捕获时无活动会话」情形，真正断连由 `wsSend` 内部静默失败兜底。纯前端改动，刷新即生效。
```

替换为：

```
- **整段发送 + 回车分离（2026-07-14 修改，原逐字符发送）**：`sendInputBar()` 把 `文本.replace(/\n/g,'\r')`（**不含末尾回车**）作为**一条** `input` 消息整段发出，停顿 `ENTER_DELAY=300ms` 后**单独发一条 `\r` input 消息**=确认/执行。根因：逐字符发送时每字符一条独立消息、间隔 15ms，TUI 始终在逐键交互模式，长命令超过行编辑器长度上限报错 `windows ctrl+v may block large input for large paste. use alt+v for fast paste`；右键粘贴是整段一次性 `pty.write`，TUI 进入粘贴/快速模式绕过上限故正常。回车分离原因：整段 blob 里的 `\r` 在粘贴模式被当字段内换行而非执行（即 2026-07-13 原逐字符要解决的坑），故把末尾回车从 blob 中拆出、延迟后单独发，让 TUI 当一次手动回车=执行。\n→\r 归一保留（终端回车键产生 `\r` 而非 `\n`，TUI raw 模式只认 `\r` 作换行/确认信号）。发送前捕获 `targetId = activeId`，发送途中切换会话不串台；`if (!targetId) return` 仅保护「捕获时无活动会话」情形，真正断连由 `wsSend` 内部静默失败兜底。纯前端改动，刷新即生效。
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: 更新注意事项 35——输入条改为整段发送+回车分离"
```

---

### Task 4: 真机/浏览器验收

**Files:**
- 验证对象：`public/index.html`（已部署，刷新即生效，无需重启服务器）

**Interfaces:**
- Consumes: 实现后的 `sendInputBar`（Task 1-3 产出）、现成运行中的服务器（端口 65433）。
- Produces: 验收结论（通过/不通过），不改动代码。

- [ ] **Step 1: 确认后端在跑**

运行：`Get-NetTCPConnection -LocalPort 65433`
预期：有监听记录（TCP 状态 Listen）。若无，按 `AGENTS.md` 开发工作流用现成服务，本次只改前端不重启。

- [ ] **Step 2: Android 真机/桌面浏览器连上终端，测长命令**

1. 打开输入条，粘贴/输入一条**很长的命令**（之前会中途报错的那种长度）。
2. 回车发送：正文整段进入 TUI、**停顿约 300ms 后**命令被执行。
3. 确认**不再出现** `windows ctrl+v may block large input for large paste. use alt+v for fast paste` 报错。
4. 对比右键粘贴同一长命令：两者行为一致（都不报错）；回车分离的 300ms 停顿手感接近人工操作。
5. 浏览器控制台（F12）无红字报错；前端日志（`设置`→`日志`）有 `输入条发送: <内容>` 一条记录（非逐字符多条）。

- [ ] **Step 3: 回归快捷键/发按键/换行按钮**

确认底部快捷键、发按键面板、换行按钮（`insertNewline` 仅在 textarea 插 `\n` 编辑草稿、不发送）行为不受影响；多行草稿发送时内部换行保留为字段内换行、仅最后独立回车执行。

- [ ] **Step 4: Commit（仅当验收中发现需补丁时）**

若验收发现需修正，改完 `git add` 对应文件并提交；若仅验收通过无改动，跳过本步。

---

## Self-Review

**1. Spec 覆盖：**
- §3.1 改后 `sendInputBar`（整段 + 回车分离 + `\n`→`\r` + targetId 捕获）→ Task 2 实现 ✅
- §3.2 删除 TYPING_DELAY、保留 sleep、新增 ENTER_DELAY → Task 1 实现 ✅
- §3.3 不动 server.js / 协议 / 其他面板 → Task 2 仅改 `sendInputBar`，Task 4 回归验证 ✅
- §4 性能影响（O(N)→O(1)）→ 无需专门任务，Task 2 代码即体现 ✅
- §5 验收 → Task 4 实现 ✅
- §7 更新 AGENTS.md 注意事项 35 → Task 3 实现 ✅

**2. Placeholder 扫描：** 无 TBD/TODO/"类似 Task N"。所有代码步骤均含完整代码块。✅

**3. 类型/命名一致性：** `ENTER_DELAY`、`textSeq`、`targetId`、`sleep(ms)`、`wsSend`、`clearInputBar`、`addFrontendLog` 在 Task 1-2 与 Task 3 文档描述中命名一致；`data: ch` → `data: textSeq` / `data: '\r'` 与代码同步更新。✅
