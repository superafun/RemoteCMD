# BEL 终端响铃通知通道实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端检测到 PowerShell 输出的 BEL 字符 `\x07` 时，向前端发送 `bell` 消息，前端显示带终端名的 Toast 并用 Web Audio API 播放蜂鸣。

**Architecture:** 在 `server.js` 的 `ptyProcess.onData` 中增加 `\x07` 检测分支：过滤 BEL 后照常发送 data，同时广播 `bell`。在 `public/index.html` 中增加 `bell` 消息处理函数 `showBellToast(id)` 和 `playBeep()`，复用现有 `.toast` 样式。

**Tech Stack:** Node.js, Express, ws, node-pty, xterm.js, Web Audio API.

## Global Constraints

- 禁止私自重启服务器；改 `server.js` 后只通知用户自行运行 `npm run restart`。
- 每次代码修改后必须立即 `git commit`；一个独立变更一个 commit。
- 不引入新依赖、新配置、新 WebSocket 消息类型以外的字段。
- 保持 PowerShell 7 (`pwsh.exe`) 子进程不变。
- 不修改已有 `data`/`buffer`/`list` 语义。
- 保持单文件架构：`server.js` 为唯一后端文件，`public/index.html` 内联 JS/CSS。
- 无测试框架；通过手动测试验证。

---

## File Structure

- `server.js`：修改 `ptyProcess.onData` 回调，新增 `bell` 消息广播。
- `public/index.html`：新增 `bell` 消息处理、Toast 显示、Web Audio 蜂鸣函数。
- `public/styles.css`：无需修改（复用现有 `.toast` 样式）。
- `docs/superpowers/specs/2026-07-14-bell-notification-design.md`：实现参考，不修改。

---

### Task 1: 后端检测 BEL 并广播 bell 消息

**Files:**
- Modify: `server.js:126-133`（`createSession` 内 `ptyProcess.onData` 回调）

**Interfaces:**
- Consumes: 无新增依赖。
- Produces: 新增 WebSocket 消息 `{ type: 'bell', id: <sessionId> }`。

- [ ] **Step 1: 修改 `ptyProcess.onData` 处理 BEL 字符**

  将原代码：
  ```js
  ptyProcess.onData((d) => {
      sessions[newId].buffer += d;
      if (sessions[newId].buffer.length > maxBufferChars * 2) {
          sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
      }
      broadcast({ type: 'data', id: newId, data: d });
  });
  ```

  改为：
  ```js
  ptyProcess.onData((d) => {
      sessions[newId].buffer += d;
      if (sessions[newId].buffer.length > maxBufferChars * 2) {
          sessions[newId].buffer = sessions[newId].buffer.slice(-maxBufferChars);
      }
      if (d.includes('\x07')) {
          broadcast({ type: 'bell', id: newId });
          const cleaned = d.replace(/\x07/g, '');
          if (cleaned) broadcast({ type: 'data', id: newId, data: cleaned });
      } else {
          broadcast({ type: 'data', id: newId, data: d });
      }
  });
  ```

  **注意：**
  - `buffer` 保留原始 `d`（含 `\x07`），不修改。
  - 一个 chunk 中无论有几个 `\x07`，只广播一次 `bell`。
  - 过滤后若 chunk 为空，则不发送 `data` 消息。

- [ ] **Step 2: 验证语法正确性**

  Run: `node -c server.js`
  Expected: 无输出（Syntax OK）。

- [ ] **Step 3: 提交后端变更**

  ```bash
  git add server.js
  git commit -m "feat: 后端检测 BEL 字符并广播 bell 消息"
  ```

---

### Task 2: 前端处理 bell 消息并显示 Toast

**Files:**
- Modify: `public/index.html`（ws.onmessage 分支 + 新增函数）

**Interfaces:**
- Consumes: `ws.onmessage` 中新增 `msg.type === 'bell'` 分支；`sessions` Map 已存在。
- Produces: `showBellToast(id)` 函数；`playBeep()` 函数。

- [ ] **Step 1: 在 `ws.onmessage` 中增加 `bell` 分支**

  在现有 `msg.type` 处理链中（参考 `public/index.html:510-610` 附近）找到合适位置，添加：
  ```js
  } else if (msg.type === 'bell') {
      showBellToast(msg.id);
      playBeep();
  }
  ```

  建议紧跟在 `buffer` 分支之后、`current_size` 分支之前，保持按消息类型分组。

- [ ] **Step 2: 新增 `showBellToast(id)` 函数**

  在 `public/index.html` 内合适位置（例如 `openLogModal` 函数之后、`function fbBtn(...)` 之前）添加：
  ```js
  function showBellToast(id) {
      const s = sessions.get(id);
      if (!s) return;  // 终端已不存在，不显示
      const toast = document.createElement('div');
      toast.className = 'toast toast-success';
      toast.textContent = `终端通知: ${s.name}`;
      document.body.appendChild(toast);
      void toast.offsetHeight;
      toast.classList.add('toast-show');
      setTimeout(() => {
          toast.classList.remove('toast-show');
          setTimeout(() => toast.remove(), 300);
      }, 1500);
  }
  ```

- [ ] **Step 3: 新增 `playBeep()` 函数**

  在 `showBellToast` 函数之后添加：
  ```js
  let audioCtx = null;
  function playBeep() {
      try {
          if (!audioCtx) {
              audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          }
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.frequency.value = 1000;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.1);
      } catch (e) {
          // 浏览器自动播放策略拒绝时静默失败，不影响 Toast 显示
      }
  }
  ```

- [ ] **Step 4: 验证 HTML 无语法错误**

  由于 `public/index.html` 没有构建工具，直接打开浏览器访问 `http://localhost:<端口>` 查看页面是否能加载。
  若服务器未运行，使用 `Get-NetTCPConnection -LocalPort <端口>` 检查；若未运行，请用户执行 `npm run restart`（AI 不可自行重启）。

- [ ] **Step 5: 提交前端变更**

  ```bash
  git add public/index.html
  git commit -m "feat: 前端处理 bell 消息，显示 Toast 并播放 Web Audio 蜂鸣"
  ```

---

### Task 3: 手动测试验证

**Files:**
- 无文件修改，仅测试。

- [ ] **Step 1: 确保服务器运行**

  在 PowerShell 中运行：
  ```powershell
  Get-NetTCPConnection -LocalPort <端口>
  ```
  若无输出，通知用户运行 `npm run restart` 启动服务器。

- [ ] **Step 2: 浏览器打开页面并登录终端**

  访问 `http://localhost:<端口>`，确认已有终端或新建一个终端。

- [ ] **Step 3: 触发 BEL 通知**

  在终端中执行：
  ```powershell
  Write-Host "`a"
  ```
  或
  ```powershell
  [Console]::Write("`a")
  ```

  **预期结果：**
  - 右上角出现蓝底 Toast：`终端通知: Shell #1`（或当前终端名）。
  - 听到一声短促蜂鸣（若浏览器允许自动播放）。
  - 终端显示区域无异常，`` 不显示为乱码。

- [ ] **Step 4: 验证 `[console]::Beep()` 不触发**

  在终端中执行：
  ```powershell
  [console]::Beep()
  ```

  **预期结果：** 无 Toast、无蜂鸣（这是设计约束，因为它不走 PTY 输出）。

- [ ] **Step 5: 验证多终端场景**

  新建第二个终端，在第二个终端中执行 `Write-Host "\`a"`。
  **预期结果：** Toast 显示 `终端通知: Shell #2`，蜂鸣一声。

- [ ] **Step 6: 测试完成后更新 AGENTS.md 注意事项**

  若测试通过，在 `AGENTS.md` 中新增一条注意事项：
  > 41. **BEL 字符通知通道（2026-07-14 引入）**：后端检测到 PTY 输出 `\x07` 时向前端广播 `bell` 消息，前端显示 `终端通知: <终端名>` Toast 并播放 Web Audio 蜂鸣。PowerShell 中可用 `Write-Host "\`a"` 或 `[Console]::Write("\`a")` 触发。`[console]::Beep()` 直接调用 Windows 音频 API，不走 PTY，因此不会触发。

- [ ] **Step 7: 提交 AGENTS.md 更新**

  ```bash
  git add AGENTS.md
  git commit -m "docs: AGENTS.md 补充 BEL 通知通道说明"
  ```

---

## 自评检查

1. **Spec coverage:**
   - 后端 BEL 检测与 `bell` 消息广播 → Task 1
   - 前端 Toast 显示 → Task 2
   - Web Audio 蜂鸣 → Task 2
   - `[console]::Beep()` 不触发 → Task 3 测试步骤
   - 多终端测试 → Task 3
   - 文档更新 → Task 3

2. **Placeholder scan:** 无 TBD/TODO/ vague 描述；每个步骤包含完整代码和命令。

3. **Type consistency:** 新消息类型为 `bell`，字段为 `id`（数字），与现有 `data`/`buffer` 的 `id` 类型一致。`showBellToast(id)` 参数与 `sessions` Map 的 key 类型一致。

4. **无外部依赖/新配置：** 确认无需修改 `package.json`、`config.json`。

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-bell-notification.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
