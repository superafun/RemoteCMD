# BELL 升级为系统通知（OS Notification）设计文档

- 日期：2026-07-21
- 状态：已批准，待写实现计划
- 范围：最小可用版（MVP）。仅把现有 BELL 通知链路升级为额外触发浏览器系统通知，不引入新的触发机制（OSC 哨兵等）。

## 背景与目标

RemoteCMD 已有一套 BELL 通知链路：PTY 输出 `\x07` → 后端去抖 → `broadcast({type:'bell', id})` → 前端 `showBellToast(id)` + `playBeep()`（页内 Toast + 蜂鸣）。

目标：在该链路基础上，额外触发**浏览器系统级通知**（`Notification` API → 操作系统弹窗），使得用户在切走标签页 / 最小化窗口时也能收到「终端有事」的提示。本期只复用 BELL 触发源，不做新的信号识别。

## 非目标（本期不做，留待后续）

- 不引入 OSC 私有序列 / 显式「任务完成」哨兵。
- 不新增独立消息类型（如 `task_done`）。
- 不改动后端 BELL 检测逻辑。
- 不处理局域网 HTTP 下的 HTTPS 安全上下文（当前 `localhost:<端口>` 已是 secure context，`Notification` 可直接用）。

## 设计

### 1. 后端

零改动。BELL 检测（`server.js` `ptyProcess.onData` 内去抖）与 `broadcast({type:'bell', id})` 保持不变。

### 2. 前端：接收侧加一步系统通知（`public/index.html`）

现有 `msg.type === 'bell'` 分支（`index.html` 约 835 行）当前为：

```js
} else if (msg.type === 'bell') {
    if (bellToastEnabled) showBellToast(msg.id);
    if (bellSoundEnabled) playBeep();
}
```

改为在末尾条件触发系统通知：

```js
} else if (msg.type === 'bell') {
    if (bellToastEnabled) showBellToast(msg.id);
    if (bellSoundEnabled) playBeep();
    if (bellOsEnabled) fireOsNotification(msg.id);
}
```

新增函数 `fireOsNotification(id)`：

- 前置：仅当 `bellOsEnabled` 为 true 且 `Notification.permission === 'granted'` 才弹窗。
- 标题：`'终端通知'`。
- 正文：`'<终端名> 触发提示'`（终端名由会话列表按 `id` 取，取不到时回退 `'终端'`）。
- `const n = new Notification('终端通知', { body, tag: 'remote-cmd-bell' });`
- `n.onclick = () => { window.focus(); n.close(); };`（点击回到页面，可选小增强）

### 3. 新开关 `bellOsEnabled`

完全照搬 `bellToastEnabled` / `bellSoundEnabled` 的既有模式，保证打断性功能有独立 kill switch（默认开）：

- `config.json`：在 `loadConfig()` 默认值中加入 `bellOsEnabled: true`，并在兜底校验段加入「非 boolean 则回退 true」逻辑。
- 落盘 + 广播：新增 `type: 'bell_os_enabled'` 的 C→S 处理与 S→C 广播，与 `bell_toast_enabled` 同构。
- 前端状态变量：`let bellOsEnabled = true;`
- 设置弹窗：在通知分组内新增一行勾选框「系统通知（OS 弹窗）」，绑定 `applySettingsBellOsEnabled()`，即时应用（`onchange`），无「应用」按钮（符合勾选框即时生效偏好）。
- 前端 `bell` 接收分支与 `bell_toast_enabled` / `bell_sound_enabled` 的同步 handler 同构：收到 `bell_os_enabled` 消息时更新 `bellOsEnabled` 并记前端日志。

### 4. 权限申请

- 用户在设置弹窗勾选「系统通知」时（首次开启），调用 `Notification.requestPermission()` 申请权限。
- 若 `Notification.permission === 'denied'`，在该设置项旁显示提示文字，告知需在浏览器地址栏手动允许通知；此时不弹系统通知，但 Toast + 蜂鸣仍照常。
- 若浏览器不支持 `Notification`（老旧环境），开关实际无效，不报错。

## 防刷屏

BELL 本身已有「输出停止 `bellDebounceMs` 后才通知一次」的去抖语义（`server.js` 的 `bellTimer`/`bellArmed`）。系统通知挂在同一条 BELL 消息上，因此与 Toast / 蜂鸣同一节奏，不会被刷爆。本期不新增去抖逻辑。

## 测试

1. 本地 `npm run start` 启动（或重启）后，浏览器打开 `http://localhost:<端口>`。
2. 在设置弹窗勾选「系统通知（OS 弹窗）」，确认浏览器弹出权限请求并允许。
3. 最小化窗口或切到别的标签页。
4. 在终端运行会输出 `\x07` 的命令，例如：
   - `Write-Host \`a`
   - 或 `echo $([char]7)`
5. 预期：操作系统弹出通知「终端通知 / <终端名> 触发提示」；切回页面仍能看到页内 Toast + 听到蜂鸣。
6. 取消勾选「系统通知」，重复第 4 步：预期仍有 Toast + 蜂鸣，但**不**再弹系统通知。
7. 拒绝浏览器通知权限后：预期 Toast + 蜂鸣正常，系统通知不弹，设置项旁有提示。

## 后续可扩展（不在本期）

- 独立 `task_done` 消息 + OSC 私有哨兵，用于「Agent 显式完成信号」语义，与 BELL 解耦。
- 通知正文携带自定义消息（任务名 / 结果）。
- 局域网 HTTP 部署下的 HTTPS 安全上下文支持。
