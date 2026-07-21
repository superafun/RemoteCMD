# ntfy 安卓系统通知推送（最小可用版）

日期：2026-07-22
状态：已批准，实现中

## 目标
在现有 BEL 响铃链路基础上，增加一个出口：当终端触发 BEL（已去抖）时，后端向 ntfy 话题 POST 一行消息，用户安卓手机（已装 ntfy App 并订阅话题）即时收到系统通知。

## 设计原则（复用现有机制，零改 BEL 检测）
- **复用后端 BEL 去抖**：`bellArmed` / `bellDebounceMs` 已在后端，天然防刷屏，不重复造轮子。
- **后端发起推送**：服务器进程做 `fetch()` POST，浏览器关掉也能推（只要服务器在跑）。前端只负责配置。
- **默认关闭**：`ntfyEnabled` 默认 `false`，话题默认空，不采集不推送。
- **可配置 + 多端同步**：话题与开关走 `config.json` + WS，和现有 `bellOsEnabled` 完全一致的处理方式。
- **话题即密码**：话题名由用户自定，必须随机不可猜；公共 `ntfy.sh` 仅用于验证，隐私敏感可日后自建。

## 协议（新增，沿用现有 bell_* 风格）
- 后端→前端连接时广播：`{ type:'ntfy_enabled', data }`、`{ type:'ntfy_topic', data }`
- 前端→后端：`{ type:'ntfy_enabled', data:boolean }`、`{ type:'ntfy_topic', data:string }`
- 后端收到后 `broadcast` 同步所有客户端 + `saveConfig`。

## 配置字段（config.json）
- `ntfyEnabled`: boolean，默认 `false`
- `ntfyTopic`: string，默认 `''`（如 `remotecmd-9f3a2c7b`）

## 后端改动（server.js）
1. `loadConfig()` 默认块加 `ntfyEnabled: false, ntfyTopic: ''`
2. 兜底段加类型校验
3. 连接广播加 `ntfy_enabled` / `ntfy_topic`
4. `ws.on('message')` 加两个 `else if` 分支
5. BEL 定时器回调（`broadcast({type:'bell', id})` 之后）加：
   ```js
   if (config.ntfyEnabled && config.ntfyTopic) {
       const name = sessions[newId] ? sessions[newId].name : '终端';
       fetch('https://ntfy.sh/' + encodeURIComponent(config.ntfyTopic), {
           method: 'POST',
           headers: { 'Title': 'RemoteCMD 通知', 'Tag': 'bell' },
           body: `终端「${name}」任务完成`
       }).catch(() => {});
   }
   ```
   （fire-and-forget，失败静默；Node 18+ 自带 fetch）

## 前端改动（public/index.html）
1. 状态变量 `let ntfyEnabled = false; let ntfyTopic = '';`
2. 设置弹窗「通知」分组内、OS 弹窗行之后插入一行：
   - checkbox `settingsNtfyEnabledInput` + `onchange=applySettingsNtfyEnabled()`
   - text input `settingsNtfyTopicInput`（placeholder 提示随机话题）+ 应用按钮 `applySettingsNtfyTopic()`
   - 提示 span `hint-ntfy`
3. 回填 `settingsNtfyEnabledInput.checked` / `settingsNtfyTopicInput.value`
4. apply 函数：`ntfy_enabled` 即时 `wsSend`；`ntfy_topic` 校验非空后 `wsSend`
5. WS handler：`ntfy_enabled` / `ntfy_topic` 更新本地变量 + `addFrontendLog('in')`

## 验证步骤
1. 用户安卓 ntfy App 订阅一个随机话题（如 `remotecmd-9f3a2c7b`）。
2. 设置弹窗开「推送通知到手机(ntfy)」并填入该话题，点应用。
3. 终端执行 `echo $([char]7)`（或脚本完成信号）触发 BEL 去抖。
4. 观察手机是否收到系统通知。
5. 通后考虑：自建私有 ntfy、优先级/标签/点击动作等增强（本期不做）。

## 不做（本期范围外）
- 自建 ntfy 服务 / 鉴权
- 通知内容模板化、优先级、附件、按钮动作
- 前端侧推送（一律后端发起）
