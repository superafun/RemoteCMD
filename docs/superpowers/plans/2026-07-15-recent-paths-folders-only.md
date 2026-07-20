# 最近路径只记录文件夹路径（剥离文件路径）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"最近路径"只收文件夹路径——盘符路径若是文件则记其父文件夹，不存在则跳过，不记文件路径。

**Architecture:** 在 server 端匹配到盘符路径后，用 `fs.promises.stat` 判定真实磁盘类型：目录记本身、文件记父文件夹、不存在/出错跳过。新增纯函数 `resolveFolderToRecord(raw)`（返回 `Promise<string|null>`）并改写 input 分支检测块用 `.then` 串接；`addRecentPath` 与前端不变。

**Tech Stack:** Node.js（`fs` + `path` + `ws`），单文件后端 `server.js`；前端 `public/index.html` 本次不动。

## Global Constraints

- 用户数据（最近路径）一律走 `config.json` + WebSocket 多端同步，**禁止** localStorage。
- 多端同步变更记日志，调用现有 `addFrontendLog(msg, 'in')`（前端已就绪，本次不变）。
- 正则仅匹配本地盘符路径 `[A-Za-z]:\`，不触发 UNC / 网络路径。
- 判定规则（方案 A 改进版）：**是目录→记本身；是文件→记父文件夹；不存在→跳过（不兜底、不扩展名启发式）**。
- 改动 `server.js` 后**必须重启后端**才能生效（用户环境约定，需主动告知）；AI 绝不私自重启。

---

## 文件改动地图

- Modify: `server.js` 约第 177 行后（`removeRecentPath` 函数之后）—— 新增 `resolveFolderToRecord` + `normalizePath`
- Modify: `server.js:358-362`（`ws.on('message')` 的 `input` 分支检测块）—— 用 `.then` 串接 `resolveFolderToRecord`
- 不动：`public/index.html`、`addRecentPath`、`removeRecentPath`、正则

---

### Task 1: 新增 resolveFolderToRecord + normalizePath

**Files:**
- Modify: `server.js` —— 在 `removeRecentPath` 函数（约第 177 行）之后插入两个纯函数

**Interfaces:**
- 新增 `normalizePath(s)`：`string -> string`，剥末尾 `\`（`C:\` 根保留）。
- 新增 `resolveFolderToRecord(raw)`：`string -> Promise<string|null>`，stat 判定，返回应记录的文件夹路径或 null。
- 下游（Task 2）消费 `resolveFolderToRecord(m[0]).then(folder => { if (folder) addRecentPath(folder); })`。
- 依赖：已导入的 `fs`（含 `fs.promises`）、`path`、`addRecentPath`。

- [ ] **Step 1: 在 `server.js` 的 `removeRecentPath` 函数结束 `}` 之后插入**

```js
// 判定一个盘符路径应记入的"文件夹路径"：
// 是目录 → 本身；是文件 → 其父文件夹；不存在/出错 → null（跳过，不记录）
// 返回 Promise<string|null>
function resolveFolderToRecord(raw) {
    const p = (raw || '').trim();
    if (!p) return Promise.resolve(null);
    return fs.promises.stat(p)
        .then(stats => {
            if (stats.isDirectory()) return normalizePath(p);
            if (stats.isFile()) return normalizePath(path.dirname(p));
            return null;
        })
        .catch(() => null);
}

// 剥掉末尾反斜杠（C:\ 根保留，避免把 C:\ 记成 C:）
function normalizePath(s) {
    if (s.length > 3 && s.endsWith('\\')) return s.slice(0, -1);
    return s;
}
```

- [ ] **Step 2: 静态校验语法**

```bash
node --check server.js
```
Expected: 无报错输出（exit 0）。

- [ ] **Step 3: 逻辑 sanity 测试（node 内联复刻，验证判定语义）**

用 node 在临时目录/文件上验证 `resolveFolderToRecord` 的判定语义（复刻两份函数，断言三类场景）：

```bash
node -e "
const fs=require('fs'); const path=require('path');
const normalizePath=s=>(s.length>3&&s.endsWith('\\\\')?s.slice(0,-1):s);
const r=p=>{p=(p||'').trim(); if(!p) return Promise.resolve(null); return fs.promises.stat(p).then(st=>st.isDirectory()?normalizePath(p):st.isFile()?normalizePath(path.dirname(p)):null).catch(()=>null);};
(async()=>{
  const dir=fs.mkdtempSync('C:\\\\tmp\\\\rp-');
  const file=path.join(dir,'a.txt'); fs.writeFileSync(file,'');
  const missing=path.join(dir,'nope');
  console.log('dir   ->', await r(dir));          // 应 = dir（本身，已 normalize）
  console.log('file  ->', await r(file));         // 应 = dir（父文件夹）
  console.log('miss  ->', await r(missing));       // 应 = null（跳过）
  fs.rmSync(dir,{recursive:true,force:true});
})();
"
```
Expected 输出：
```
dir   -> C:\tmp\rp-XXXX   (临时目录自身，无尾斜杠)
file  -> C:\tmp\rp-XXXX   (父文件夹，与 dir 相同)
miss  -> null
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: 新增 resolveFolderToRecord 判定应记录的文件夹路径"
```

---

### Task 2: input 分支检测块改用 .then 串接

**Files:**
- Modify: `server.js:358-362`（`ws.on('message')` 的 `type === 'input'` 分支内检测块）

**Interfaces:**
- 消费 Task 1 的 `resolveFolderToRecord(raw)`（返回 `Promise<string|null>`）与既有 `addRecentPath(p)`。
- `feedInputLine` / 正则 `/\b[A-Za-z]:\\[^\s"'`]+/` 不变；只把同步 `addRecentPath(m[0])` 改为异步串接。

- [ ] **Step 1: 改写 input 分支检测块**

将 `server.js` 当前：
```js
            const line = feedInputLine(sessions[id], data);
            if (line) {
                const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/);
                if (m) addRecentPath(m[0]);
            }
```
替换为：
```js
            const line = feedInputLine(sessions[id], data);
            if (line) {
                const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/);
                if (m) {
                    resolveFolderToRecord(m[0]).then(folder => {
                        if (folder) addRecentPath(folder);
                    });
                }
            }
```
要点：
- 用 `.then` 串接，不把整个 `ws.on('message')` 回调改成 `async`，避免影响其它同步分支（`pty.write`、其它 type 分支）的时序。
- `resolveFolderToRecord` 返回 null 时（路径不存在/出错）不调 `addRecentPath`，即跳过。
- 仅当判定出文件夹路径才调 `addRecentPath`（去重置顶截断落盘广播不变）。

- [ ] **Step 2: 静态校验语法**

```bash
node --check server.js
```
Expected: 无报错输出（exit 0）。

- [ ] **Step 3: 确认未误改其它分支**

Read `server.js:352-365`，确认：
- `sessions[id].pty.write(data)` 仍在 `feedInputLine` 之前（输入照常写入 PTY）；
- `recent_paths_delete` / `kill` / `buffer` 等其它分支原样未动；
- 仅 `input` 分支内部的 `addRecentPath(m[0])` 改为 `.then` 串接。

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: 输入分支检测改用 resolveFolderToRecord 只记文件夹"
```

---

### Task 3: 验收（真实环境验证）

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 重启后端**

`server.js` 已改（Task 1 + Task 2），**必须重启 Node 服务**使改动生效。告知用户本次需重启（AI 不私自重启）。

- [ ] **Step 2: 安卓真机场景验证**

刷新浏览器（安卓真机 HTTPS）。在终端依次试：
- `cd C:\Users\fmy3\OneDrive\学习` → 点「最近路径」应见 `C:\Users\fmy3\OneDrive\学习`。
- `notepad C:\Users\fmy3\a.txt`（a.txt 存在）→ 应记 `C:\Users\fmy3`（父文件夹，不是文件）。
- `type C:\x\y\z.log`（z.log 不存在）→ **不应新增任何路径**。
- `cd C:\尚不存在的文件夹`（不存在）→ **不应新增任何路径**。
- 打开 设置 → 日志，确认新增项有「最近路径已添加: ...」记录。

- [ ] **Step 3: 多端同步 + 落盘验证**

- 另一浏览器/终端打开 → 同步看到上述文件夹路径、日志有对应「已添加」记录。
- 重启 server 后重新打开 → 已记录项仍在（`config.json` 落盘）。

- [ ] **Step 4: 边界回归**

- `cd C:\Users\fmy3\OneDrive\学习\自主研发课题\专利`（中文深层文件夹，存在）→ 记该完整文件夹路径。
- 含尾斜杠的文件夹路径（若存在）→ 记时剥掉尾 `\`。
- 删除（✕）功能、复制功能照常（前端未改）。

- [ ] **Step 5: 无新增 commit（仅验证）；如有 bug 修复则单独 commit 并说明**

---

## 自审（已执行）

1. **Spec 覆盖**：判定三类（目录/文件/不存在）→ Task 1 `resolveFolderToRecord` + Task 2 串接覆盖；`normalizePath` 剥尾斜杠、C:\ 根保留 → Task 1 覆盖；不存在跳过（不兜底）→ `resolveFolderToRecord` 的 `.catch(()=>null)` 覆盖；`addRecentPath`/前端/正则不变 → 明确「不动」；多端同步+日志 → 沿用既有（本次不变）。全部覆盖。
2. **占位符扫描**：无 TBD/TODO；每步含真实代码与命令。
3. **类型一致性**：`resolveFolderToRecord(raw: string): Promise<string|null>` 在 Task 1 定义、Task 2 以 `m[0]`（string）调用并以 `.then(folder => ...)` 消费（folder 为 `string|null`），命名/签名两处一致；`normalizePath(s: string): string` 仅在 Task 1 内部使用，一致；`addRecentPath(p)` 既有签名未变。
