# 最近路径保存条数可配置（recentPathsLimit）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"最近路径"保存条数从硬编码 10 改为可在设置弹窗配置、随 config.json 落盘、连接时下发、多端实时同步的设置项 `recentPathsLimit`（范围 1–100，默认 10，缩容即时截断）。

**Architecture:** 完全复用现有 19 个设置的「五处协议端点」同步机制（前端 apply 发送 / 后端保存分支 / 后端连接下发 / 前端 ws 接收 / 弹窗回填）。服务端 `addRecentPath` 的截断上限由常量改为 `config.recentPathsLimit`。

**Tech Stack:** Node.js (server.js)、原生前端 (public/index.html，内联 JS)、WebSocket JSON 协议、config.json 持久化。

## 关键约束（本项目特有，务必遵守）

- **禁止用 Edit / Write 工具改写 `server.js` / `public/index.html` / `AGENTS.md`**——这些文件含中文，Edit/Write 会把它污染成 `?`(0x3F) 或 U+FFFD(efbfbd)。所有改动必须走**字节级 Node 脚本**：`fs.readFileSync(p,'utf8')` → 先 `s = s.replace(/\r\n/g,'\n')` 归一 CRLF → 用 `s.split(old).join(new)`（字面量替换，**禁用正则**）逐处修改 → `fs.writeFileSync(p, s)` 写回。脚本本体用 `cat > patch.js <<'EOF' ... EOF`（引号 heredoc 保留 UTF-8 中文）生成。
- 每个文件改完必须跑字节校验：`node -e "const fs=require('fs');const s=fs.readFileSync(p,'utf8');let f=0,k=0;for(const c of s){const cp=c.codePointAt(0);if(cp===0xFFFD)f++;if(cp>=0x3040&&cp<=0x30FF)k++;}console.log('fffd=',f,'kana=',k)"`，要求 **fffd=0 且 kana=0**。
- `git diff` 行数应仅为新增的十几行（无全文件 CRLF 改写、无中文乱码）。
- 每完成一个文件即 `git commit`；最终 AGENTS.md 也必须同步更新并提交（用户固定期望：代码 commit + AGENTS.md 更新成对出现）。

---

### Task 1: server.js — 五处后端改动（落盘默认值 / 校验 / 截断 / 保存分支 / 连接下发）

**Files:**
- Modify: `server.js`

**Interfaces:**
- 新增配置字段 `config.recentPathsLimit`（number, 1–100），被 `addRecentPath` 读取、被 `recent_paths_limit` 消息写入。
- 新增 WebSocket 消息：`recent_paths_limit`（C→S 更新上限；S→C 广播新上限 + 缩容时附带的 `recent_paths`）。

- [ ] **Step 1: 写字节级补丁脚本并执行**

```bash
cat > /tmp/patch_server.js <<'EOF'
const fs = require('fs');
const p = 'server.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const edits = [
  // 1) 默认值：recentPaths 之后加 recentPathsLimit: 10
  [
    "            recentPaths: [],\n",
    "            recentPaths: [],\n            recentPathsLimit: 10,\n"
  ],
  // 2) 读取校验：sessionDurationHours 校验行之后加 recentPathsLimit 校验
  [
    "    if (typeof cfg.sessionDurationHours !== 'number' || !isFinite(cfg.sessionDurationHours) || cfg.sessionDurationHours <= 0) cfg.sessionDurationHours = 24;\n",
    "    if (typeof cfg.sessionDurationHours !== 'number' || !isFinite(cfg.sessionDurationHours) || cfg.sessionDurationHours <= 0) cfg.sessionDurationHours = 24;\n    if (!Number.isInteger(cfg.recentPathsLimit) || cfg.recentPathsLimit < 1 || cfg.recentPathsLimit > 100) cfg.recentPathsLimit = 10;\n"
  ],
  // 3) 截断上限：slice(0, 10) -> slice(0, config.recentPathsLimit)
  [
    "].slice(0, 10);",
    "].slice(0, config.recentPathsLimit);"
  ],
  // 4) ws 保存分支：在 session_duration_hours 块之后、rename 分支之前插入
  [
    "            saveConfig(config);\n        }\n\n        else if (type === 'rename' && sessions[id]) {",
    "            saveConfig(config);\n        }\n\n        else if (type === 'recent_paths_limit') {\n            const v = parseInt(data);\n            if (!Number.isInteger(v) || v < 1 || v > 100) return;\n            config.recentPathsLimit = v;\n            if (config.recentPaths.length > v) {\n                config.recentPaths = config.recentPaths.slice(0, v);\n                broadcast({ type: 'recent_paths', data: config.recentPaths });\n            }\n            broadcast({ type: 'recent_paths_limit', data: config.recentPathsLimit });\n            saveConfig(config);\n        }\n\n        else if (type === 'rename' && sessions[id]) {"
  ],
  // 5) 连接时下发：recent_paths 下发之后加 recent_paths_limit 下发
  [
    "    ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));\n",
    "    ws.send(JSON.stringify({ type: 'recent_paths', data: config.recentPaths }));\n    ws.send(JSON.stringify({ type: 'recent_paths_limit', data: config.recentPathsLimit }));\n"
  ],
];

for (const [oldS, newS] of edits) {
  if (!s.includes(oldS)) { console.error('ANCHOR MISSING:\n' + oldS); process.exit(1); }
  s = s.split(oldS).join(newS);
}
fs.writeFileSync(p, s);
console.log('server.js patched OK');
EOF
node /tmp/patch_server.js
```

- [ ] **Step 2: 语法校验 + 字节校验**

```bash
node --check server.js
node -e "const fs=require('fs');const s=fs.readFileSync('server.js','utf8');let f=0,k=0;for(const c of s){const cp=c.codePointAt(0);if(cp===0xFFFD)f++;if(cp>=0x3040&&cp<=0x30FF)k++;}console.log('fffd=',f,'kana=',k);"
```
Expected: `node --check` 无输出（通过）；`fffd=0 kana=0`。

- [ ] **Step 3: 提交**

```bash
git add server.js
git commit -m "feat: make recent-paths limit configurable (recentPathsLimit 1-100, default 10)"
```

---

### Task 2: public/index.html — 四处前端改动（变量声明 / 弹窗输入行 / 回填 / 应用函数 / ws 接收）

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- 新增前端变量 `recentPathsLimit`（默认 10）。
- 新增设置弹窗输入行 `settingsRecentPathsLimitInput` + 应用按钮 `btn-apply-recentPathsLimit`。
- 新增 `applySettingsRecentPathsLimit()`：校验 1–100 后 `wsSend({type:'recent_paths_limit', data:v})`，`fbBtn` 反馈。
- 新增 ws 接收分支 `recent_paths_limit` → 赋值 `recentPathsLimit`。

- [ ] **Step 1: 写字节级补丁脚本并执行**

```bash
cat > /tmp/patch_index.js <<'EOF'
const fs = require('fs');
const p = 'public/index.html';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const edits = [
  // 1) 变量声明：recentPaths 之后加 recentPathsLimit
  [
    "        let recentPaths = [];\n",
    "        let recentPaths = [];\n        let recentPathsLimit = 10;\n"
  ],
  // 2) 弹窗输入行：maxFrontendLogs 块之后、session keep-login 注释之前插入
  [
    "            html += '<button class=\"btn-primary\" id=\"btn-apply-maxFrontendLogs\" onclick=\"applySettingsMaxFrontendLogs()\">应用</button>';\n            html += '</div>';\n\n            // session keep-login duration (hours)\n",
    "            html += '<button class=\"btn-primary\" id=\"btn-apply-maxFrontendLogs\" onclick=\"applySettingsMaxFrontendLogs()\">应用</button>';\n            html += '</div>';\n\n            // 最近路径保存条数 (1-100)\n            html += '<div class=\"modal-row\">';
            html += '<span class=\"modal-label\">最近路径保存条数</span>';
            html += '<input type=\"number\" id=\"settingsRecentPathsLimitInput\" min=\"1\" max=\"100\" style=\"width:80px;\">';
            html += '<button class=\"btn-primary\" id=\"btn-apply-recentPathsLimit\" onclick=\"applySettingsRecentPathsLimit()\">应用</button>';
            html += '</div>';\n\n            // session keep-login duration (hours)\n"
  ],
  // 3) 回填：sessionDuration 回填之后加 recentPathsLimit 回填
  [
    "            document.getElementById('settingsSessionDurationInput').value = sessionDurationHours;\n",
    "            document.getElementById('settingsSessionDurationInput').value = sessionDurationHours;\n            document.getElementById('settingsRecentPathsLimitInput').value = recentPathsLimit;\n"
  ],
  // 4) 应用函数：applySettingsSessionDuration 之后、尺寸槽位注释之前插入
  [
    "        function applySettingsSessionDuration() {\n            const v = parseFloat(document.getElementById('settingsSessionDurationInput').value);\n            if (Number.isFinite(v) && v > 0) {\n                wsSend({ type: 'session_duration_hours', data: v });\n                fbBtn('btn-apply-sessionDuration', true);\n            } else {\n                fbBtn('btn-apply-sessionDuration', false);\n            }\n        }\n\n        // === 大/小尺寸槽位应用（2026-07-01 引入） ===\n",
    "        function applySettingsSessionDuration() {\n            const v = parseFloat(document.getElementById('settingsSessionDurationInput').value);\n            if (Number.isFinite(v) && v > 0) {\n                wsSend({ type: 'session_duration_hours', data: v });\n                fbBtn('btn-apply-sessionDuration', true);\n            } else {\n                fbBtn('btn-apply-sessionDuration', false);\n            }\n        }\n\n        function applySettingsRecentPathsLimit() {\n            const v = parseInt(document.getElementById('settingsRecentPathsLimitInput').value);\n            if (Number.isInteger(v) && v >= 1 && v <= 100) {\n                wsSend({ type: 'recent_paths_limit', data: v });\n                fbBtn('btn-apply-recentPathsLimit', true);\n            } else {\n                fbBtn('btn-apply-recentPathsLimit', false);\n            }\n        }\n\n        // === 大/小尺寸槽位应用（2026-07-01 引入） ===\n"
  ],
  // 5) ws 接收分支：session_duration_hours 接收块之后、restart_server 之前插入
  [
    "                    } else if (msg.type === 'session_duration_hours') {\n                        sessionDurationHours = msg.data;\n                        addFrontendLog('保持登录时长同步为 ' + sessionDurationHours + ' 小时', 'in');\n                    } else if (msg.type === 'restart_server') {",
    "                    } else if (msg.type === 'session_duration_hours') {\n                        sessionDurationHours = msg.data;\n                        addFrontendLog('保持登录时长同步为 ' + sessionDurationHours + ' 小时', 'in');\n                    } else if (msg.type === 'recent_paths_limit') {\n                        recentPathsLimit = msg.data;\n                        addFrontendLog('最近路径保存条数同步为 ' + recentPathsLimit + ' 条', 'in');\n                    } else if (msg.type === 'restart_server') {"
  ],
];

for (const [oldS, newS] of edits) {
  if (!s.includes(oldS)) { console.error('ANCHOR MISSING:\n' + oldS); process.exit(1); }
  s = s.split(oldS).join(newS);
}
fs.writeFileSync(p, s);
console.log('index.html patched OK');
EOF
node /tmp/patch_index.js
```

- [ ] **Step 2: 字节校验**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('public/index.html','utf8');let f=0,k=0;for(const c of s){const cp=c.codePointAt(0);if(cp===0xFFFD)f++;if(cp>=0x3040&&cp<=0x30FF)k++;}console.log('fffd=',f,'kana=',k);"
```
Expected: `fffd=0 kana=0`。

- [ ] **Step 3: 提交**

```bash
git add public/index.html
git commit -m "feat: add recentPathsLimit setting UI (input row, backfill, apply, ws receive)"
```

---

### Task 3: AGENTS.md — 同步协议表与配置字段

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- 协议表新增两行（`recent_paths_limit`：S→C 下发、C→S 更新）。
- 配置字段段落补充 `recentPathsLimit`。

- [ ] **Step 1: 写字节级补丁脚本并执行**

```bash
cat > /tmp/patch_agents.js <<'EOF'
const fs = require('fs');
const p = 'AGENTS.md';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const edits = [
  // S->C 协议表：session_duration_hours 行之后插入
  [
    "| `session_duration_hours` | 保持登录时长（单位：小时，无上限，正数即可） |\n",
    "| `session_duration_hours` | 保持登录时长（单位：小时，无上限，正数即可） |\n| `recent_paths_limit` | 最近路径保存条数上限（data，单位：条，范围 1–100，默认 10），连接建立时下发 + 设置变更时广播 |\n"
  ],
  // C->S 协议表：session_duration_hours 行之后插入
  [
    "| `session_duration_hours` | 更新保持登录时长（data，单位：小时，无上限） |\n",
    "| `session_duration_hours` | 更新保持登录时长（data，单位：小时，无上限） |\n| `recent_paths_limit` | 更新最近路径保存条数上限（data，单位：条，1–100） |\n"
  ],
  // 配置字段段落：maxFrontendLogs 之前补 recentPathsLimit
  [
    "、`maxFrontendLogs` |",
    "、`recentPathsLimit`（最近路径保存条数，默认 10，范围 1–100）、`maxFrontendLogs` |"
  ],
];

for (const [oldS, newS] of edits) {
  if (!s.includes(oldS)) { console.error('ANCHOR MISSING:\n' + oldS); process.exit(1); }
  s = s.split(oldS).join(newS);
}
fs.writeFileSync(p, s);
console.log('AGENTS.md patched OK');
EOF
node /tmp/patch_agents.js
```

- [ ] **Step 2: 字节校验**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('AGENTS.md','utf8');let f=0,k=0;for(const c of s){const cp=c.codePointAt(0);if(cp===0xFFFD)f++;if(cp>=0x3040&&cp<=0x30FF)k++;}console.log('fffd=',f,'kana=',k);"
```
Expected: `fffd=0 kana=0`。

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md
git commit -m "docs: sync AGENTS.md with recentPathsLimit setting (protocol table + config field)"
```

---

### Task 4: 验证

- [ ] **Step 1: 服务端语法 + 默认值生效**

```bash
node --check server.js
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('config.json','utf8'));console.log('recentPathsLimit=', c.recentPathsLimit);"
```
Expected: `node --check` 通过；若 config.json 尚无该字段，`loadConfig` 兜底为 10（重启服务后验证：`console.log(server 启动日志无报错)`）。

- [ ] **Step 2: 浏览器 / 真机验证**
  1. 打开设置弹窗，确认出现「最近路径保存条数」输入框（默认 10）。
  2. 改为 3 并点「应用」→ 下拉列表上限立即变为 3（缩容即时截断，`recent_paths` 重新广播）。
  3. 刷新页面 → 设置保持 3（连接时 `recent_paths_limit` 下发）。
  4. 另一客户端/标签页 → 设置同步为 3（多端同步）。
  5. 改为 100 后 `cd` 多个目录 → 确认最多累积到 100 条。
  6. 观察前端日志出现「最近路径保存条数同步为 N 条」。

- [ ] **Step 3: git diff 行数检查**

```bash
git diff --stat HEAD~3
```
Expected: 仅 `server.js` / `public/index.html` / `AGENTS.md` 三文件有增量，无全文件重写。

---

## 自检（写作时已完成）

- **Spec 覆盖**：默认值✓、校验✓、截断改指向✓、ws 保存分支✓、连接下发✓、弹窗输入✓、回填✓、应用函数✓、ws 接收✓、缩容即时截断✓、AGENTS.md 同步✓。
- **Placeholder 扫描**：无 TBD/TODO；所有步骤含实际 old/new 代码。
- **类型一致性**：`recent_paths_limit` 五处端点 type 字符串、`recentPathsLimit` 变量名、按钮 id `btn-apply-recentPathsLimit`、输入 id `settingsRecentPathsLimitInput` 在所有任务中拼写一致。
- **中文污染防护**：全程字节级脚本 + fffd/kana 校验，未使用 Edit/Write 改写含中文文件。
