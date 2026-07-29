# 输入条逐字符发送修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把底部「输入条」的「发送」按钮从"整段一次性发送"改为"逐字符发送（每字符一条消息 + 15ms 延时）"，使其效果等同于底部 Enter 快捷键，在 TUI 里不再被解释成换行。

**Architecture:** 仅改前端 `public/index.html` 的 `sendInputBar()`：拼接出 `文本.replace(/\n/g,'\r') + '\r'` 序列后，用 `for...of` 逐字符各发一条 `wsSend({type:'input', id: targetId, data: ch})`，字符间 `await sleep(TYPING_DELAY)`。不动 `server.js`、不加 WebSocket 消息。同步更新 `AGENTS.md` 注意事项。

**Tech Stack:** 纯前端 JS（浏览器原生，无打包/框架）、WebSocket（`wsSend` 统一入口）、xterm.js 终端。

## Global Constraints

- 所有 WebSocket 发送必须走 `wsSend()`，禁止直接 `ws.send()`（AGENTS.md 编码约定）。
- 纯前端改动，不动 `server.js`、不加 WebSocket 消息类型。
- 每次代码修改完成后必须立即 git commit，禁止累积；`git add` 指定文件，禁止 `git add -A`。
- 提交信息用 Conventional Commits 风格（`<前缀>: <一句话描述>`）。
- 改动需附带性能影响分析（本改动：10–50 条消息替代原 1 条，无新增 DOM/监听器，15ms 延时属打字节奏，无内存开销）。
- 输入条展开时 `#inputBarBtn` 与 `#hotkeysList` 均 `display:none`（注意事项 35 既有行为，本次保持不变）。
- 移动端：点发送后焦点交还终端、软键盘不收回（注意事项 35/36 既有行为，本次保持不变）。

---

### Task 1: 新增 sleep 辅助与 TYPING_DELAY 常量

**Files:**
- Modify: `public/index.html`（在 `sendInputBar()` 上方，约 L933 附近）

**Interfaces:**
- Produces: `function sleep(ms)`（返回 `Promise`）、常量 `TYPING_DELAY`（数值，单位 ms，默认 15）
- 这两个符号供 Task 2 的 `sendInputBar()` 使用。

- [ ] **Step 1: 在 `sendInputBar()` 上方插入 sleep 辅助与常量**

  定位 `function sendInputBar() {`（当前约 L933），在其正上方插入：

  ```js
  // 逐字符发送时每个字符之间的延时（ms），模拟真人敲键节奏；如需更慢/更快改这里
  const TYPING_DELAY = 15;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  ```

- [ ] **Step 2: 保存文件，浏览器刷新确认无语法错误**

  用安卓真机或桌面浏览器打开 `http://localhost:<端口>`（若服务在跑直接刷新；改的是前端静态文件，无需重启服务器）。
  打开浏览器控制台（F12），确认无红字报错（此时尚未改发送逻辑，`sendInputBar` 仍是旧实现，仅验证新增符号不破坏加载）。

- [ ] **Step 3: Commit**

  ```bash
  cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
  git add public/index.html
  git commit -m "feat: 输入条新增逐字符发送用的 sleep 辅助与 TYPING_DELAY 常量"
  ```

---

### Task 2: 改写 sendInputBar 为逐字符发送

**Files:**
- Modify: `public/index.html`（`sendInputBar()` 函数体，约 L933-939）

**Interfaces:**
- Consumes: `sleep(ms)`（Task 1）、`TYPING_DELAY`（Task 1）、`activeId`（全局当前会话 id）、`wsSend(obj)`（全局统一发送入口）、`closeInputBar()`（既有，收起输入条并 `sessions.get(activeId)?.focus()` 交还焦点）、`addFrontendLog(msg, dir)`（既有日志）
- Produces: 无新导出符号；行为变更——「发送」改为逐字符发送。

- [ ] **Step 1: 用以下实现替换原 `sendInputBar()` 函数体**

  原实现（约 L933-939）：
  ```js
  function sendInputBar() {
      const t = inputBarText.value.replace(/\n+$/, '');  // 去掉末尾换行，避免多发空行
      if (!t) { closeInputBar(); return; }               // 空内容：仅关闭不发送
      sendInput(t.replace(/\n/g, '\r') + '\r');          // \n→\r 并补末尾回车执行
      addFrontendLog('输入条发送: ' + t, 'out');
      closeInputBar();                                   // 发送后自动关闭
  }
  ```

  替换为：
  ```js
  async function sendInputBar() {
      const t = inputBarText.value.replace(/\n+$/, '');   // 去末尾换行，避免多发空行
      if (!t) { closeInputBar(); return; }                 // 空内容：仅关闭不发送
      const targetId = activeId;                            // 捕获目标会话，防止发送途中切换会话串台
      const seq = t.replace(/\n/g, '\r') + '\r';           // \n→\r 并补末尾回车
      closeInputBar();                                      // 先收起输入条、把焦点交还终端
      addFrontendLog('输入条发送: ' + t, 'out');
      for (const ch of seq) {
          if (!targetId) break;                             // 连接已断开则中止剩余发送
          wsSend({ type: 'input', id: targetId, data: ch });
          await sleep(TYPING_DELAY);
      }
  }
  ```

- [ ] **Step 2: 浏览器实测——普通 PowerShell 提示符**

  刷新网页。输入条填 `Get-Date`，点「发送」。预期：命令被逐字符敲入并执行，输出当前日期时间（与敲命令后回车一致）。打开前端「日志」按钮，应能看到一条 `输入条发送: Get-Date` 的 out 日志。

- [ ] **Step 3: 浏览器实测——TUI 场景**

  在 PowerShell 提示符运行一个读取逐键输入的 TUI（例如 `choice /c YN /m "确认?"` 或任意全屏菜单程序）。用输入条填 `Y` 点发送。预期：效果与按底部 Enter 键一致（确认/执行），TUI 不再把发送当成换行。若手边无合适 TUI，可用 `Read-Host` 验证：输入条填任意文本点发送，文本进入 Read-Host 提示并回车确认返回。

- [ ] **Step 4: 边界实测——空输入 / 发送途中切换会话**

  - 空输入条点「发送」：仅收起输入条，不发送、不出日志噪音。
  - 填较长文本（如 30+ 字符）点发送，在发送进行中（约 1s 内）切换到另一个终端：剩余字符应仍发往原终端，不串台（验证 `targetId` 捕获）。
  - 安卓真机：点「发送」后软键盘不收回（焦点已交还终端）。

- [ ] **Step 5: Commit**

  ```bash
  cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
  git add public/index.html
  git commit -m "fix: 输入条发送改为逐字符发送，等价于 Enter 快捷键，修复 TUI 里变换行的问题"
  ```

---

### Task 3: 更新 AGENTS.md 注意事项

**Files:**
- Modify: `AGENTS.md`（注意事项 35，约 L303 附近「底部输入条」段落）

**Interfaces:**
- Consumes: 本次改动事实（逐字符发送 + 15ms 延时）
- Produces: 无。

- [ ] **Step 1: 在注意事项 35 末尾补充逐字符发送说明**

  在注意事项 35 现有内容（输入条功能描述、移动端软键盘修复、纯前端改动）之后，追加一段：

  ```
  - **逐字符发送（2026-07-13 引入）**：`sendInputBar()` 不再把整段文本拼成一条消息一次性发出，而是拼接 `文本.replace(/\n/g,'\r') + '\r'` 序列后，**逐字符各发一条独立 `input` 消息**，字符间 `await sleep(TYPING_DELAY)`（固定 15ms 常量，模拟真人敲键）。原因：TUI 把"整段一次性灌入"当粘贴/缓冲文本，`\r` 被解释成字段内换行；而底部 Enter 快捷键是单独一条 `\r` 消息，TUI 当作真实按键=确认。逐字符发送后 TUI 把每字符当独立按键，`\r` 回到确认语义，与 Enter 快捷键一致。发送前捕获 `targetId = activeId`，发送途中切换会话不串台；循环中 `if (!targetId) break` 断开时中止。纯前端改动，刷新即生效。
  ```

- [ ] **Step 2: Commit**

  ```bash
  cd "c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD"
  git add AGENTS.md
  git commit -m "docs: AGENTS.md 注意事项 35 补充输入条逐字符发送说明"
  ```

---

## Self-Review

1. **Spec 覆盖**：§3.1（仅改 sendInputBar + 新增 sleep/TYPING_DELAY）→ Task 1+2；§3.2 新逻辑逐字符+targetId 捕获+closeInputBar 先调用+断续保护 → Task 2 Step 1；§3.4 不动 server.js/协议 → 全局约束已声明；§4 性能影响 → Global Constraints 已写；§5 验收 5 条 → Task 2 Step 2-4 覆盖；§6 范围外 → 未做，符合。全覆盖。
2. **Placeholder 扫描**：无 TBD/TODO/"类似 Task N"/"加适当错误处理"等占位。每个代码步骤均给出完整代码与命令。
3. **类型一致性**：`sleep` / `TYPING_DELAY` 在 Task 1 定义、Task 2 使用，命名一致；`wsSend` / `activeId` / `closeInputBar` / `addFrontendLog` 均为既有全局符号，签名与 AGENTS.md 一致。
