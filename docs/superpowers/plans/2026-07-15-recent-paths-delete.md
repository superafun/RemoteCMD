# 最近路径单条删除 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户在「最近路径」下拉里单条删除某条路径，删除经 server 落盘 `config.json` 并多端同步、记日志。

**Architecture:** Server 是单一数据源。前端点 `✕` → 发 `{type:'recent_paths_delete', data: path}` → server 从 `config.recentPaths` 过滤掉该 path → 落盘 → `broadcast({type:'recent_paths', data, deleted: path})` → 所有前端重渲染下拉并记同步日志。复用现有 `addRecentPath` / `addFrontendLog` 结构，无新机制。

**Tech Stack:** Node.js (`ws` + `fs`) 后端；原生 HTML/CSS/JS 单文件前端 `public/index.html`。

## Global Constraints

- 用户数据（含最近路径）一律走 `config.json` + WebSocket 多端同步，**禁止** localStorage。
- 多端同步变更必须记日志，调用现有 `addFrontendLog(msg, 'in')`（与其他设置项同步一致）。
- 删除**不**做二次确认，直接删 + `showToast('已删除','success')`。
- 路径文本一律用 `textContent` 设置，不得拼接进 innerHTML（防注入）。
- 改动保持最小，不引入「清空全部」、不搬到设置面板（YAGNI）。
- 改动 `server.js` 后**必须重启后端**才能生效（用户环境约定，需主动告知）。

---

## 文件改动地图

- Modify: `server.js:111-117` 之后 —— 新增 `removeRecentPath()`
- Modify: `server.js:274` 之后（`ws.on('message')` 路由内）—— 新增 `recent_paths_delete` 分支
- Modify: `public/index.html:1106-1127`（`renderRecentPathsDropdown()`）—— 每行加 `✕` 按钮 + 点击删除 + stopPropagation
- Modify: `public/index.html:951-957`（`ws.onmessage` 的 `recent_paths` 分支）—— 日志文案区分 added/deleted/同步
- Modify: `public/index.html:35-43`（`.recent-path-item` 样式区）—— 新增 `✕` 按钮与行布局样式

---

### Task 1: server 新增 removeRecentPath + 路由分支

**Files:**
- Modify: `server.js` （在 `addRecentPath` 函数体之后，约第 117 行后插入）
- Modify: `server.js` （`ws.on('message')` 内，`type === 'input'` 分支之后，约第 274 行后插入分支）

**Interfaces:**
- 新增函数 `removeRecentPath(raw)`：`raw` 为待删除路径字符串；从 `config.recentPaths` 过滤移除，落盘并广播。后续 Task 无需调用它（仅由 ws 路由调用）。
- 新增下游消息 `{ type: 'recent_paths', data: string[], deleted: string }`，前端 Task 3 消费 `deleted` 字段。
- 上游消息 `{ type: 'recent_paths_delete', data: string }`，由前端 Task 2 发送。

- [ ] **Step 1: 在 `addRecentPath` 之后插入 `removeRecentPath`**

在 `server.js` 第 117 行（`addRecentPath` 函数结束的 `}`）之后、第 119 行注释之前插入：

```js
// 删除一条最近路径：从列表过滤移除 + 落盘 + 广播（与 addRecentPath 同款结构）
function removeRecentPath(raw) {
    const p = (raw || '').trim();
    if (!p) return;
    const before = config.recentPaths.length;
    config.recentPaths = config.recentPaths.filter(x => x !== p);
    if (config.recentPaths.length === before) return; // 本就不在列表，无变化不广播
    saveConfig(config);
    broadcast({ type: 'recent_paths', data: config.recentPaths, deleted: p });
}
```

- [ ] **Step 2: 在 `ws.on('message')` 路由内新增分支**

在 `server.js` 第 274 行（`type === 'input'` 分支的结束 `}` 之后）新增一行：

```js
        else if (type === 'recent_paths_delete') removeRecentPath(data);
```

（放在 `else if (type === 'kill' ...)` 之前或之后均可，保持 `else if` 链结构。）

- [ ] **Step 3: 静态校验逻辑**

用 node 直跑验证 `removeRecentPath` 的过滤/幂等行为（无需框架）：

```bash
node -e "
const c={recentPaths:['C:\\\\a','D:\\\\b','C:\\\\a']};
const f=p=>{const before=c.recentPaths.length;c.recentPaths=c.recentPaths.filter(x=>x!==p);if(c.recentPaths.length===before)return 'no-op';return 'removed';};
console.log(f('D:\\\\b')); console.log(JSON.stringify(c.recentPaths));
console.log(f('Z:\\\\x')); console.log(JSON.stringify(c.recentPaths));
"
```

Expected: 输出 `removed`、`["C:\\a","C:\\a"]`、`no-op`、`["C:\\a","C:\\a"]`（说明不存在的 path 不产生副作用）。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: server 支持单条删除最近路径 (removeRecentPath + 路由分支)"
```

---

### Task 2: 前端下拉每行加 ✕ 删除按钮

**Files:**
- Modify: `public/index.html:1106-1127`（`renderRecentPathsDropdown()` 函数体）
- Modify: `public/index.html:35-43`（`.recent-path-item` 样式，新增 `.recent-path-del` 按钮样式）

**Interfaces:**
- 消费：全局 `function wsSend(obj)`（已存在，发送 WS 消息）
- 消费：全局 `function showToast(message, type)`（已存在）
- 消费：`let recentPaths = []`（已存在，下拉数据源）

- [ ] **Step 1: 改写 `renderRecentPathsDropdown()` 为「路径 + ✕ 按钮」布局**

将 `public/index.html` 第 1116-1126 行（`recentPaths.forEach` 块）整体替换为：

```js
            recentPaths.forEach(p => {
                const item = document.createElement('div');
                item.className = 'recent-path-item';

                const label = document.createElement('span');
                label.className = 'recent-path-label';
                label.textContent = p;   // 用 textContent，避免路径特殊字符破坏 DOM
                item.appendChild(label);

                const del = document.createElement('button');
                del.className = 'recent-path-del';
                del.type = 'button';
                del.textContent = '✕';   // ✕ (U+2715)
                del.title = '删除该路径';
                del.addEventListener('click', (e) => {
                    e.stopPropagation();  // 避免触发整行复制
                    wsSend({ type: 'recent_paths_delete', data: p });
                    showToast('已删除', 'success');
                });
                item.appendChild(del);

                item.addEventListener('click', () => {
                    copyToClipboard(p);
                    showToast('已复制', 'success');
                    dd.classList.remove('open');
                });
                dd.appendChild(item);
            });
```

注意：函数头 `const dd = document.getElementById('recentPathsDropdown'); dd.innerHTML = '';` 及空列表分支保持不变，仅改 `forEach` 内部。

- [ ] **Step 2: 新增/调整 CSS**

在 `public/index.html` 第 35-42 行 `.recent-path-item` 块之后、`.recent-path-item:hover` 之前插入：

```css
        .recent-path-item {
            padding: 6px 8px;
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            max-width: 360px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .recent-path-label {
            flex: 1 1 auto;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .recent-path-del {
            flex: 0 0 auto;
            border: none;
            background: transparent;
            color: #999;
            cursor: pointer;
            font-size: 13px;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 4px;
        }
        .recent-path-del:hover { background: rgba(255, 80, 80, 0.18); color: #ff6b6b; }
```

（覆盖原 `.recent-path-item` 的 `text-overflow`/旧 padding，改用 flex 行布局让 `✕` 靠右；保留 `.recent-path-item:hover` 背景行高亮不变。）

- [ ] **Step 3: 静态校验**

确认 `✕` 按钮 `click` 里用了 `e.stopPropagation()`，避免点删除时同时触发复制；确认 `del` 与 `label` 均为 `createElement` + `textContent`，无 innerHTML 拼接。

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: 最近路径下拉每行加 ✕ 删除按钮 (stopPropagation 区分复制)"
```

---

### Task 3: 前端日志文案区分 已添加/已删除/已同步

**Files:**
- Modify: `public/index.html:951-957`（`ws.onmessage` 的 `recent_paths` 分支）

**Interfaces:**
- 消费：全局 `function addFrontendLog(msg, dir)`（已存在，`dir` 用 `'in'`）
- 消费：上游 `{ type: 'recent_paths', data, added?, deleted? }`（`added` 来自 Task 1 的 addRecentPath 广播；`deleted` 来自 removeRecentPath 广播）

- [ ] **Step 1: 改写 `recent_paths` 分支日志逻辑**

将 `public/index.html` 第 951-957 行整体替换为：

```js
                    } else if (msg.type === 'recent_paths') {
                        recentPaths = msg.data || [];
                        renderRecentPathsDropdown();
                        if (msg.added) {
                            addFrontendLog('最近路径已添加: ' + msg.added + ' (共 ' + recentPaths.length + ' 条)', 'in');
                        } else if (msg.deleted) {
                            addFrontendLog('最近路径已删除: ' + msg.deleted + ' (共 ' + recentPaths.length + ' 条)', 'in');
                        } else {
                            addFrontendLog('最近路径已同步: ' + recentPaths.length + ' 条', 'in');
                        }
                    }
```

- [ ] **Step 2: 静态校验**

确认三种分支均调用 `addFrontendLog(..., 'in')`，与既有设置项同步日志风格一致；`msg.added` / `msg.deleted` 仅在对应 broadcast 时存在，互斥。

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: 最近路径同步日志区分 已添加/已删除/已同步"
```

---

### Task 4: 验收（真实环境验证）

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 重启后端**

`server.js` 已改，必须重启 Node 服务（如 `npm run restart` 或手动重启进程）使 `removeRecentPath` 与路由分支生效。告知用户本次需重启。

- [ ] **Step 2: 安卓真机单条删除**

刷新浏览器（安卓真机走 HTTPS）。点顶部「最近路径」按钮展开下拉，点某条路径右侧 `✕`：
- 该项立即从下拉消失；
- 出现 `showToast('已删除')`；
- 打开 设置 → 日志，应看到 `最近路径已删除: <path> (共 N 条)`。

- [ ] **Step 3: 多端同步验证**

在另一浏览器/终端打开同一服务：被删项已消失；其日志里也有对应「已删除」记录。

- [ ] **Step 4: 落盘持久化验证**

重启 server 后重新打开：被删项不再出现（确认已从 `config.json` 移除）。

- [ ] **Step 5: 边界回归**

- 删除不存在的路径 / 空列表下点 `✕`：不报错、不产生错误日志。
- 点路径行其余位置：仍正常复制到剪贴板。
- 新敲带盘符命令：仍正常「已添加」并置顶，不影响删除逻辑。

- [ ] **Step 6: 无新增 commit（仅验证）；如有 bug 修复则单独 commit 并说明**

---

## 自审（已执行）

1. **Spec 覆盖**：交互（✕ 按钮）✅ Task 2；不二次确认 ✅ Task 2（直接删+toast）；server 单一数据源 ✅ Task 1；多端同步+落盘 ✅ Task 1（saveConfig+broadcast）；日志区分 ✅ Task 3；边界幂等 ✅ Task 1（长度无变化 return）。全部覆盖。
2. **占位符扫描**：无 TBD/TODO；每步均含真实代码与命令。
3. **类型一致性**：`recent_paths_delete` / `recent_paths` 消息的 `type`、`data`、`added`、`deleted` 字段在 server（Task 1 产出）与前端（Task 2 发送 `recent_paths_delete`、Task 3 消费 `added`/`deleted`）命名一致；`wsSend` / `showToast` / `addFrontendLog` / `copyToClipboard` 均为已存在全局函数，签名未变。
