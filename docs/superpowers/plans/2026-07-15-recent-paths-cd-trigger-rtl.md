# 最近路径：仅 cd 触发记录 + 右对齐截断显示 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"最近路径"仅在 `cd`/`cd /d`/`chdir` 命令时记录，且下拉里路径从右往左显示（保住末尾区分段，左侧超长自动隐去）。

**Architecture:** 两处独立改动——server 端给路径检测加 `cd` 命令闸门（复用既有 `resolveFolderToRecord` 文件夹判定）；前端给路径 label 加 `direction:rtl` 让 `text-overflow:ellipsis` 截断开头而非末尾。两者互不依赖，可分别提交。

**Tech Stack:** Node.js（`ws` + `fs` + `path`）后端 `server.js`；原生 CSS `public/styles.css` 单文件前端（注意：`.recent-path-label` 的样式在 `styles.css`，**不是** `index.html` 内联 `<style>`）。

## Global Constraints

- 用户数据（最近路径）一律走 `config.json` + WebSocket 多端同步，**禁止** localStorage。
- 多端同步变更记日志，调用现有 `addFrontendLog(msg, 'in')`（前端已就绪，本次不变）。
- 触发前缀范围：`cd` / `cd /d` / `chdir`，大小写不敏感；**不**含 `pushd`/`popd`。
- 文件夹判定：**保留** `resolveFolderToRecord`（磁盘 stat：目录记本身、文件记父文件夹、不存在跳过），不写新判定。
- 前端视觉改动**必须**用 Playwright 渲染真实生产页面 + 截图验证（非简化复现 HTML），沿用 `feedback_css_debug_use_real_page` / `feedback_css_specificity_minmax` 结论。
- 改动 `server.js` 后**必须重启后端**才生效（用户环境约定，需主动告知）；AI 绝不私自重启。

---

## 文件改动地图

- Modify: `server.js:533-544`（`ws.on('message')` 的 `type === 'input'` 分支检测块）—— 加 `cd` 闸门
- Modify: `public/styles.css:457-461`（`.recent-path-label` 规则）—— 加 `direction: rtl` + 显式 `white-space: nowrap`
- Modify: `public/styles.css:481-486`（`.recent-path-item.expanded .recent-path-label` 规则）—— 加 `direction: ltr`（展开态整条路径仍按 LTR 正常阅读）
- 不动：`index.html`、正则、`resolveFolderToRecord`、`addRecentPath`、`removeRecentPath`、`.recent-path-del` 正方形样式

---

### Task 1: server.js 加 cd 命令闸门

**Files:**
- Modify: `server.js:533-544`（`input` 分支检测块）

**Interfaces:**
- 复用既有 `resolveFolderToRecord(raw): Promise<string|null>`（已定义，返回应记录的文件夹路径或 null）。
- 复用 `feedInputLine(session, data): string|null`、`addRecentPath(p)`。
- 不新增函数；仅在现有检测块外包一层 `cd` 前缀判断。

- [ ] **Step 1: 改写 input 分支检测块**

把 `server.js` 当前（约 533-544 行）：
```js
        else if (type === 'input' && sessions[id]) {
            sessions[id].pty.write(data);
            const line = feedInputLine(sessions[id], data);
            if (line) {
                const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/);
                if (m) {
                    resolveFolderToRecord(m[0]).then(folder => {
                        if (folder) addRecentPath(folder);
                    });
                }
            }
        }
```
替换为（仅最外层 `if` 加 `&& /^\s*(cd|chdir)\b/i.test(line)` 闸门）：
```js
        else if (type === 'input' && sessions[id]) {
            sessions[id].pty.write(data);
            const line = feedInputLine(sessions[id], data);
            if (line && /^\s*(cd|chdir)\b/i.test(line)) {
                const m = line.match(/\b[A-Za-z]:\\[^\s"'`]+/);
                if (m) {
                    resolveFolderToRecord(m[0]).then(folder => {
                        if (folder) addRecentPath(folder);
                    });
                }
            }
        }
```
要点：
- `pty.write(data)` 仍在 `feedInputLine` 之前（输入照常写入 PTY），不动。
- 闸门 `/^\s*(cd|chdir)\b/i`：`\b` 防 `cdn`/`cdrom` 误匹配；`i` 大小写不敏感（`CD`/`CHDIR` 也匹配）；`cd /d D:\x` 由正则取到 `D:\x`。
- 非 `cd` 命令（如 `notepad C:\a.txt`）→ 不进 `if` → 不记录。
- `cd` 单独 / `cd ..` / `cd /` → 闸门通过但路径正则无匹配 → 不记录。

- [ ] **Step 2: 静态校验语法**

```bash
node --check server.js
```
Expected: 无报错（exit 0）。

- [ ] **Step 3: 逻辑 sanity 测试（node 复刻闸门判定）**

用 node 验证闸门的匹配语义（复刻正则，断言各类命令）：
```bash
node -e "
const gate=/^\s*(cd|chdir)\b/i;
const pathRe=/\b[A-Za-z]:\\[^\s\"'\`]+/;
const cases=['cd C:\\\\a\\\\b','cd /d D:\\\\data','CHDIR C:\\\\x','notepad C:\\\\a.txt','cd','cd ..','cdn C:\\\\a'];
for(const c of cases){const g=gate.test(c);const p=(c.match(pathRe)||[])[0]||'-';console.log(JSON.stringify(c),'gate='+g,'path='+JSON.stringify(p));}
"
```
Expected 输出（每行的 gate / 是否匹配到盘符路径）：
```
"cd C:\a\b" gate=true path="C:\a\b"
"cd /d D:\data" gate=true path="D:\data"
"CHDIR C:\x" gate=true path="C:\x"
"notepad C:\a.txt" gate=false path="-"
"cd" gate=true path="-"
"cd .." gate=true path="-"
"cdn C:\a" gate=false path="-"
```
（gate=false 的命令不会被记录；gate=true 但 path='-' 的 `cd`/`cd ..` 也无盘符路径可记 → 不记录。）

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: 最近路径仅在 cd/chdir 命令时记录"
```

---

### Task 2: 前端路径从右往左显示（direction: rtl）

**Files:**
- Modify: `public/styles.css:457-461`（`.recent-path-label` 基础规则）
- Modify: `public/styles.css:481-486`（`.recent-path-item.expanded .recent-path-label` 展开态规则）

**Interfaces:**
- 消费：`.recent-path-label` 由 `index.html` 的 `renderRecentPathsDropdown()` 用 `label.className = 'recent-path-label'; label.textContent = p;` 渲染（文本用 textContent，不受 direction 影响）。
- 消费：`.recent-path-item.expanded` 是移动端点击展开态（已有功能），展开后整条路径换行显示；本任务需保证展开态仍按 LTR 正常阅读。
- 不改动 `index.html`、不改动 `.recent-path-del` 正方形、不改动 label 的 textContent 逻辑。

- [ ] **Step 1: 修改 `.recent-path-label` 基础规则**

把 `public/styles.css` 当前（457-461 行）：
```css
.recent-path-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
}
```
替换为（加 `white-space: nowrap` 显式化 + `direction: rtl`）：
```css
.recent-path-label {
    flex: 1 1 auto;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    direction: rtl;
}
```
要点：
- `direction: rtl` 使 `text-overflow: ellipsis` 的溢出/省略号移到**左侧**，右端路径段（如 `\学习\专利`）始终可见，左侧相同前缀（`C:\Users\fmy3\...`）超长时以 `…` 隐去。
- 显式 `white-space: nowrap` 保证单行截断（`.recent-path-item` 也有 nowrap，这里显式更稳妥）。
- **不要**加 `text-align`：默认随 `direction:rtl` 解析为 `start`（右对齐），尾部贴右边缘、靠 ✕/展开按钮，正合需求；强行 `text-align:left` 反而会把溢出推到右侧、隐藏尾部。
- 路径字符本身是 LTR（ASCII + 反斜杠），读取顺序不变，仅块右对齐、头被裁。

- [ ] **Step 2: 展开态补 direction: ltr**

把 `public/styles.css` 当前（481-486 行）：
```css
#recentPathsDropdown .recent-path-item.expanded .recent-path-label {
    white-space: normal;
    word-break: break-all;
    overflow: visible;
    text-overflow: clip;
}
```
替换为（末尾加 `direction: ltr;`）：
```css
#recentPathsDropdown .recent-path-item.expanded .recent-path-label {
    white-space: normal;
    word-break: break-all;
    overflow: visible;
    text-overflow: clip;
    direction: ltr;
}
```
要点：展开态会整条换行显示完整路径，必须恢复 LTR 以免整条被反向，保证可读。

- [ ] **Step 3: Playwright 真实页面验证（关键，禁止简化复现 HTML）**

用 Playwright（chromium，viewport 1280×720）打开**真实生产页面**（本地服务，项目在 65433 端口；若不可用起临时 serve `public/` 的小服务到非常用端口）：
1. 程序触发 `#recentPathsBtn` 点击展开下拉；注入一条长路径到列表并渲染：
   ```js
   recentPaths = ['C:\\Users\\fmy3\\OneDrive\\学习\\自主研发课题\\专利\\子目录ABC'];
   renderRecentPathsDropdown();
   ```
2. 测量 `.recent-path-label` 的 `getComputedStyle`：`direction` 应为 `rtl`、`text-overflow` 为 `ellipsis`、`white-space` 为 `nowrap`。
3. **截图** `verify_rtl_label.png`，给 `.recent-path-label` 加红色 outline 标注，目视确认：
   - 右端（如 `...\专利\子目录ABC`）**可见**；
   - 左端（`C:\Users\...`）被 `…` 截断；
   - ✕ 按钮与展开按钮位置正常、点击仍删/展开照常。
4. 再测短路径（如 `C:\temp`）：整条显示、无 `…`。
5. 若截图发现尾部仍被截断（方向未生效），回到 Step 1 检查是否被其它更高特异性规则覆盖（grep `.recent-path-label` 所有规则按特异性排序），修正后重测。

- [ ] **Step 4: 静态校验 + 确认未误改其它规则**

Read `public/styles.css:455-500`，确认：
- 仅 `.recent-path-label` 与 `.recent-path-item.expanded .recent-path-label` 两条规则加了 `direction`；
- `.recent-path-item`、`.recent-path-expand`、`.recent-path-del` 规则原样未动；
- 无语法错误（可 `node -e "require('fs').readFileSync('public/styles.css','utf8')"` 确认文件可读，或浏览器加载无 CSS 解析报错）。

- [ ] **Step 5: Commit**

```bash
git add public/styles.css
git commit -m "fix: 最近路径标签从右往左显示，保住末尾区分段"
```

---

### Task 3: 验收（真实环境验证）

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 重启后端（因 Task 1 改了 server.js）**

告知用户：server.js 已改，必须重启 Node 服务生效（AI 不私自重启）。前端 CSS 改动刷新即可，但本次后端也改了，故整体重启 + 刷新最稳。

- [ ] **Step 2: 安卓真机场景验证（增强一：仅 cd 触发）**

刷新浏览器（安卓真机 HTTPS）。终端依次试：
- `cd C:\Users\fmy3\OneDrive\学习` → 最近路径记该文件夹。
- `cd /d D:\data` → 记 `D:\data`。
- `CHDIR C:\x` → 记。
- `notepad C:\Users\fmy3\a.txt` → **不记录**（核心痛点已解决）。
- `cd C:\a\b\c.txt`（文件）→ 记父文件夹 `C:\a\b`。
- `cd C:\不存在` → **不记录**。

- [ ] **Step 3: 安卓真机场景验证（增强二：右对齐显示）**

- 最近路径里放入一条长路径（如上述），下拉显示应**右端可见、左端 `…` 截断**，不再像之前那样吃掉末尾。
- 点击路径行其余位置 → 复制照常；点 ✕ → 删除照常；移动端点展开按钮 → 整条路径 LTR 正常换行可读。

- [ ] **Step 4: 多端同步 + 落盘验证**

- 另一浏览器/终端打开 → 同步看到新增文件夹、日志有「最近路径已添加」。
- 重启 server 后重新打开 → 已记录项仍在（`config.json` 落盘）。

- [ ] **Step 5: 无新增 commit（仅验证）；如有 bug 修复则单独 commit 并说明**

---

## 自审（已执行）

1. **Spec 覆盖**：增强一 cd 闸门 → Task 1（regex `/^\s*(cd|chdir)\b/i` + 复用 resolveFolderToRecord）；增强二 右对齐 → Task 2（`.recent-path-label` `direction:rtl` + 展开态 `direction:ltr`）；文件夹判定保留 → Task 1 不改 resolveFolderToRecord；多端同步/日志 → 前端已就绪本次不变；Playwright 真实页面验证 → Task 2 Step 3 强制。全部覆盖。
2. **占位符扫描**：无 TBD/TODO；每步含真实代码与命令。
3. **类型一致性**：`resolveFolderToRecord(raw): Promise<string|null>`、`feedInputLine`、`addRecentPath` 在两任务中签名一致；`/^\s*(cd|chdir)\b/i` 与 `/\[A-Za-z]:\\.../` 在 Task 1 内一致；`direction:rtl/ltr` 仅 Task 2 CSS 使用。
4. **关键修正**：`.recent-path-label` 样式经 grep 确认在 **`public/styles.css:457`**（非 index.html 内联），计划已据此修正目标文件；同时兼顾已存在的 `.expanded` 展开态避免整条反向。
