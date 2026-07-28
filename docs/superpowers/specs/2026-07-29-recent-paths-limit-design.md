# 最近路径保存条数可配置（recentPathsLimit）设计

**日期**: 2026-07-29
**状态**: 已批准，待实现

## 背景

"最近路径"列表当前由服务端维护在 `config.recentPaths`（`server.js`），并通过 WebSocket 广播给所有客户端，本身已是多端同步的。但其保存条数上限是**硬编码**的 `.slice(0, 10)`（`server.js:351` 的 `addRecentPath`），无法更改。

本设计把"保存条数"变成普通设置项 `recentPathsLimit`，复用现有 19 个设置的「五处协议端点」同步机制，使其与其他设置一样可在弹窗里配置、落盘 `config.json`、连接时下发、多端实时同步。

## 范围

- 仅新增一个设置项 `recentPathsLimit`，不改动"最近路径"的采集/去重/置顶/删除逻辑（除截断上限指向新变量）。
- 不引入新消息类型族；沿用现有 `type` 字段约定。
- 不允许 0（0 表示"禁用"在用户选择中被排除）；取值范围 **1–100，默认 10**。

## 设计

### 后端 `server.js`

1. **默认值**（`loadConfig` 的 `def` 对象，约第 32 行附近）：新增
   ```js
   recentPathsLimit: 10,
   ```

2. **读取兜底/校验**（在 `loadConfig` 现有校验段之后）：
   ```js
   if (!Number.isInteger(cfg.recentPathsLimit) || cfg.recentPathsLimit < 1 || cfg.recentPathsLimit > 100) cfg.recentPathsLimit = 10;
   ```

3. **应用新值**（`addRecentPath`，`server.js:351`）：
   ```js
   config.recentPaths = [p, ...config.recentPaths.filter(x => x !== p)].slice(0, config.recentPathsLimit);
   ```

4. **ws 保存分支**（`wss.on('connection')` 的 `ws.on('message')` 处理器，紧接 `session_duration_hours` 分支之后）：
   ```js
   else if (type === 'recent_paths_limit') {
       const v = parseInt(data);
       if (!Number.isInteger(v) || v < 1 || v > 100) return;
       config.recentPathsLimit = v;
       // 缩容即时生效：把已存列表截断到新上限
       if (config.recentPaths.length > v) {
           config.recentPaths = config.recentPaths.slice(0, v);
           broadcast({ type: 'recent_paths', data: config.recentPaths });
       }
       broadcast({ type: 'recent_paths_limit', data: config.recentPathsLimit });
       saveConfig(config);
   }
   ```

5. **连接时下发**（在 `wss.on('connection')` 的 `ws.send` 序列里，紧接 `recent_paths` 之后）：
   ```js
   ws.send(JSON.stringify({ type: 'recent_paths_limit', data: config.recentPathsLimit }));
   ```

### 缩容即时生效

用户把上限从 N 调小到 M 时，立即把已存储的 `recentPaths` 截断到 M 条并重新广播 `recent_paths`，下拉立刻只显示 M 条——避免"设置说 M 条但列表里还躺着更多"的不一致。扩容则自然生效（后续 `cd` 时累积，最多到新上限）。

### 前端 `public/index.html`

1. **弹窗输入框**（`openSettingsModal` 的 HTML 拼接，紧挨 `maxFrontendLogs` 那一块之后）：
   ```js
   html += '<label class="modal-label">最近路径保存条数 <input type="number" id="settingsRecentPathsLimitInput" min="1" max="100" style="width:80px;"></label>';
   ```

2. **回填**（`openSettingsModal` 内现有 `.value = ...` 序列之后）：
   ```js
   document.getElementById('settingsRecentPathsLimitInput').value = recentPathsLimit;
   ```

3. **应用函数**（与 `applySettingsMaxFrontendLogs` 同款结构）：
   ```js
   function applySettingsRecentPathsLimit() {
       const v = parseInt(document.getElementById('settingsRecentPathsLimitInput').value);
       if (Number.isInteger(v) && v >= 1 && v <= 100) {
           wsSend({ type: 'recent_paths_limit', data: v });
           fbBtn('btn-apply-recentPathsLimit', true);
       } else {
           fbBtn('btn-apply-recentPathsLimit', false);
       }
   }
   ```
   （如需"应用"按钮反馈，`fbBtn` 的 id 与上面一致即可；若沿用弹窗内即时 `onchange` 风格也可，但本设计保持与 `maxFrontendLogs` 一致的按钮式反馈。）

4. **接收分支**（`ws.onmessage` 现有 `else if` 链里加）：
   ```js
   } else if (msg.type === 'recent_paths_limit') {
       recentPathsLimit = msg.data;
   }
   ```

   说明：前端 `recentPathsLimit` 变量目前仅作展示/未来用途；真正的截断发生在服务端，所以即使旧客户端未升级，服务端仍按新上限截断并广播 `recent_paths`，行为正确。

## 五处协议端点对账（新增项）

| 端点 | 处理 |
|------|------|
| 前端 apply 发送 | `wsSend({type:'recent_paths_limit', data:v})` |
| 后端保存分支 | `else if (type === 'recent_paths_limit')` 校验 1–100 + `saveConfig` |
| 后端连接下发 | `ws.send({type:'recent_paths_limit', data: config.recentPathsLimit})` |
| 前端 ws 接收 | `else if (msg.type === 'recent_paths_limit') { recentPathsLimit = msg.data; }` |
| 弹窗回填 | `getElementById('settingsRecentPathsLimitInput').value = recentPathsLimit` |

## 验证

- `node --check server.js` 通过；前端改动经浏览器实际渲染检查（注意中文不被污染，git diff 应为十几行增量，无全文件 CRLF 重写）。
- 真机/浏览器：
  1. 打开设置，将"最近路径保存条数"改为 3，应用，下拉列表上限随之变为 3（缩容即时截断）。
  2. 刷新页面，设置保持为 3（连接时下发）。
  3. 在另一台/另一标签页客户端，设置同步为 3（多端同步）。
  4. 改为 100 再 `cd` 多个目录，确认最多累积到 100 条。

## 收尾（项目约定）

- 改动 `git commit`。
- 同步更新根目录 `AGENTS.md` 的 WebSocket 协议表与 `config.json` 配置字段段落（字节级脚本修改，防止中文被污染为 `?`/U+FFFD）。
