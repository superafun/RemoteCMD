# 最近路径：只记录文件夹路径（剥离文件路径）

- 日期：2026-07-15
- 状态：设计已确认，待写实现计划

## 背景

「最近路径」功能（2026-07-15 实现）用正则 `/\b[A-Za-z]:\\[^\s"'`]+/` 无差别匹配任何 `C:\...` 串（含末尾文件名），直接 `addRecentPath(m[0])` 记录。用户反馈 bug：**偶尔会把文件路径也记进去**，但需求是「最近路径」只收**文件夹路径**。

修正目标：
- 匹配到盘符路径后，判定它是文件夹还是文件。
- 是文件夹 → 记录该文件夹。
- 是文件 → **剥掉文件名，只记录它所在的父文件夹**（`path.dirname`）。
- 路径在磁盘上**不存在** → **跳过，不记录任何东西**（不兜底、不扩展名启发式）。

约束（沿用既有强约束）：
- 用户数据（最近路径）走 `config.json` + WebSocket 多端同步，不落 localStorage。
- 多端同步变更记前端日志（`addFrontendLog(..., 'in')`，已在上一轮实现，本次不变）。
- 正则仅匹配本地盘符路径 `[A-Za-z]:\`，不触发 UNC / 网络路径。

## 判定逻辑（方案 A 改进版）

```
输入行回车 → 正则匹配到盘符路径 p（整条 C:\... 串）
  → fs.stat(p) 判定真实磁盘状态：
      是目录 (stats.isDirectory())        → 记录 normalize(p)
      是文件 (stats.isFile())            → 记录 normalize(path.dirname(p))
      不存在 (ENOENT)                    → 跳过，不记录
```

要点：
- 只有「真实存在的目录」或其「真实存在的文件所在的父文件夹」才会进最近路径库。
- 不存在的路径一律跳过——避免把尚未创建 / 拼错的路径污染列表（用户明确不要扩展名兜底）。
- `fs.stat` 会跟随符号链接（symlink→目标类型），对用户语义正确。

## 数据流

```
ws.on('message') type:'input' 分支（server.js:358 附近）
  feedInputLine 累积输入行 → 回车时 line 非空
  → const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/)
  → if (m) {
        const folder = resolveFolderToRecord(m[0]);  // 新增：stat 判定，返回应记录的文件夹路径或 null
        if (folder) addRecentPath(folder);           // 不存在返回 null → 不记录
    }
```

## Server 改动（server.js）

1. 新增 `resolveFolderToRecord(raw)` 工具函数，返回 `Promise<string|null>`（用 `fs.promises.stat`，单次回车一条路径开销可忽略）：
   - `const p = (raw || '').trim(); if (!p) return Promise.resolve(null);`
   - `try { const stats = await fs.promises.stat(p); } catch (err) { return null; }`（任意错误含 ENOENT → 返回 null 跳过）
     - `stats.isDirectory()` → `return normalize(p)`
     - `stats.isFile()` → `return normalize(path.dirname(p))`
   - `normalize(s)`：剥掉末尾 `\`（如 `C:\a\b\` → `C:\a\b`）；`C:\` 根保持 `C:\` 不变（长度判断）；其余原样。
2. `server.js:358-361` 检测块改造：
   - 把同步 `if (m) addRecentPath(m[0]);` 改为：
     ```js
     if (m) {
         resolveFolderToRecord(m[0]).then(folder => {
             if (folder) addRecentPath(folder);
         });
     }
     ```
   - 用 `.then` 串接，不把整个 `ws.on('message')` 回调改成 async，避免影响其它同步分支时序。
   - 保持「匹配到路径才判定」；未匹配不做事。
3. `addRecentPath(raw)`（server.js:160）**不变**：去重 → 置顶 → 截断 10 → `saveConfig` → `broadcast({type:'recent_paths', data, added})`。传入的已是判定后的文件夹路径。

注意：当前 `ws.on('message')` 回调是同步的。引入异步 stat 后，仅需把 recent-path 这一段用回调/Promise 包起来，不要改动 `pty.write`、其他 type 分支等既有同步逻辑的执行时序。

## 前端改动（public/index.html）

**无。** 下拉照常显示文件夹路径、点行复制、点 ✕ 删除；同步日志沿用已实现的「已添加/已删除/已同步」文案。本次只改变"什么会被记入"，不改变展示与交互。

## 错误处理 / 边界

- 路径不存在 → `resolveFolderToRecord` 返回 null → 不记录（用户明确要求跳过）。
- 路径含中文 / 空格 → 正则 `[^\s"'`]+` 已支持；Node `fs.stat` 用 UTF-8，无碍。
- 符号链接 → `fs.stat` 跟随，按目标类型处理，符合用户预期。
- UNC / 网络路径（`\\host\...`）→ 正则不匹配（仅 `[A-Za-z]:\`），不触发。
- 正则匹配到的 `p` 末尾带文件名：`isFile` 时取 `path.dirname(p)` 得父文件夹；`path.dirname('C:\a\b\c.txt') === 'C:\a\b'`，`path.dirname('C:\a\b\\') === 'C:\a\b'`（dirname 自带剥尾斜杠）。
- 判定中 stat 抛非 ENOENT 错误（权限等）→ 同样 `return null` 跳过，不做破坏性记录。

## 测试 / 验收

1. `cd C:\Users\fmy3\OneDrive\学习` → 记入 `C:\Users\fmy3\OneDrive\学习`。
2. `notepad C:\Users\fmy3\a.txt`（a.txt 存在）→ 记入 `C:\Users\fmy3`（父文件夹）。
3. `type C:\x\y\z.log`（z.log **不存在**）→ **跳过，不记录任何东西**。
4. `cd C:\尚不存在的文件夹`（不存在）→ **跳过，不记录**。
5. 安卓真机 + 另一浏览器：新增的文件夹路径多端同步、设置→日志有「最近路径已添加」；✕ 删除照常。
6. 重启 server 后已记录项仍在（`config.json` 落盘）。

## 不在本次范围（YAGNI）

- 不引入扩展名启发式兜底（用户明确路径不存在即跳过）。
- 不改变正则表达式（仍匹配整条 `C:\...` 串，由判定逻辑决定记文件夹还是父文件夹）。
- 不改前端展示/交互（仅后端判定变化）。
- 不处理"路径不存在也想记父文件夹"——用户明确不要。
