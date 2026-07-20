# 代码清理三项：删散落文件 / 样式迁移 / 终端字体修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理仓库散落临时文件、将 index.html 内联 `<style>` 块规范化迁入 styles.css、修复 Windows 上 xterm 终端中文宋体/错位问题。

**Architecture:** 三项相互独立、均只改前端静态资源（或删除未跟踪散落文件），不涉及 server.js / WebSocket 协议 / 后端逻辑，改完刷新浏览器即可，无需重启后端。

**Tech Stack:** Node.js + Express（静态服务，本次不改）、xterm.js（前端终端，本次仅加 `fontFamily`）、原生 HTML/CSS/JS。

## Global Constraints

- 仅前端改动 + 删除未跟踪散落文件；**不重启后端**、不改动 `server.js` / `public/term-session.js` 以外的逻辑、`Unicode11Addon` 保留不删。
- 受保护不动：`server.js`、`public/`（除本计划指定两处）、`docs/`、`node_modules/`、`config.json`、`package.json`、`AGENTS.md`、`.codebuddy/`、`.opencode/`、`.git/`。
- 删除前必须 `ls` 复核清单，确认不误删任何源码 / 配置 / 文档。
- 散落内联 `style="…"`（约 40 处）本次**不迁移**；不引入自带 webfont。
- 每个 Task 结束独立 `git commit`。

---

## 文件结构

- `public/index.html` — **Modify**：删除第 12–112 行 `<style>…</style>` 块（保留两行 `<link>`）。
- `public/styles.css` — **Modify**：在文件末尾原样追加上述 `<style>` 块内容。
- `public/term-session.js` — **Modify**：第 45 行 `new Terminal({ allowProposedApi: true })` 增加 `fontFamily`。
- 根目录 18 个散落文件 + `.playwright-cli/` + `.superpowers/` — **Delete**（均未 git 跟踪）。

---

### Task 1: 删除散落临时 / 测试 / 截图文件

**Files:**
- Delete: 根目录 `_diag_recentpath.js`、`_tmp_diag_server.js`、`_wstest.js`、`_tmp_diag_server.log`、`bat_out.log`、`bug_recentpath_real.png`、`verify_recentpath_fix.png`、`inputbar-after-fix.png`、`inputbar-bug-before.png`、`inputbar-final.png`、`inputbar-top-align-single.png`、`inputbar-top-align.png`、`inputbar_current.png`、`inputbar_margin.png`、`after-reload.yml`、`base.yaml`、`check.yml`、`mobile.yml`、`reasonix.toml`
- Delete: 目录 `.playwright-cli/`
- Delete: 目录 `.superpowers/`

**Interfaces:**
- 无依赖、无产出；纯仓库清理。

- [ ] **Step 1: 复核待删清单（删除前必须执行）**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
ls -1 _diag_recentpath.js _tmp_diag_server.js _wstest.js _tmp_diag_server.log bat_out.log \
      bug_recentpath_real.png verify_recentpath_fix.png inputbar-*.png \
      after-reload.yml base.yaml check.yml mobile.yml reasonix.toml
ls -1d .playwright-cli .superpowers
```
确认列出的文件/目录均存在，且**不包含** `server.js` / `public/` / `docs/` / `config.json` 等受保护项。

- [ ] **Step 2: 删除根目录散落文件**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
rm -f _diag_recentpath.js _tmp_diag_server.js _wstest.js _tmp_diag_server.log bat_out.log \
      bug_recentpath_real.png verify_recentpath_fix.png inputbar-after-fix.png \
      inputbar-bug-before.png inputbar-final.png inputbar-top-align-single.png \
      inputbar-top-align.png inputbar_current.png inputbar_margin.png \
      after-reload.yml base.yaml check.yml mobile.yml reasonix.toml
```

- [ ] **Step 3: 删除两个工具目录**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
rm -rf .playwright-cli .superpowers
```

- [ ] **Step 4: 验证仓库状态**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git status -s
ls -1 _*.js _*.log *.png *.yml *.yaml *.toml 2>/dev/null
```
Expected: `git status -s` 中不再出现上述散落文件（除 `public/index.html` 已有的 `M` 与 `docs/` 下既有未跟踪 plan 文档外）；第二个 `ls` 无输出（文件已清空）。`node_modules/`、`server.js`、`public/`、`config.json` 完好。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add -A
git commit -m "chore: 删除散落临时/测试/截图文件（根目录 + .playwright-cli + .superpowers）"
```
注意：若 `git add -A` 误带出不应提交的文件，先用 `git reset` 撤销后按需 `git add` 具体路径再提交。

---

### Task 2: 将 index.html 内联 `<style>` 块迁入 styles.css

**Files:**
- Modify: `public/index.html`（删除第 12–112 行 `<style>…</style>`）
- Modify: `public/styles.css`（末尾追加该块内容）

**Interfaces:**
- 无依赖、无产出；纯样式位置迁移，选择器不变、功能不变。

- [ ] **Step 1: 确认 styles.css 无同名选择器重复**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
grep -nE "\.toast|\.recent-path|\.dropdown-menu|\.dropdown-empty|#recentPathsDropdown" public/styles.css
```
Expected: 无输出（styles.css 当前不含这些选择器，可安全追加）。

- [ ] **Step 2: 向 styles.css 末尾追加以下整块内容（原样，含注释与缩进）**

将 `public/index.html` 第 12–112 行 `<style>` 与 `</style>` 之间的全部 CSS 原样追加到 `public/styles.css` 文件末尾（可整体补一个空行分隔）：

```css
/* ===== Toast / 最近路径 / 下拉菜单（原 index.html 内联 <style> 迁入） ===== */
/* Toast 提示：复制成功/失败（右上角 + 滑入动画） */
.toast {
    position: fixed;
    top: 16px;
    right: 16px;
    transform: translateX(120%);
    opacity: 0;
    padding: 8px 16px;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    z-index: 2000;
    pointer-events: none;
    transition: transform 0.25s ease, opacity 0.25s ease;
}
.toast.toast-show {
    transform: translateX(0);
    opacity: 0.95;
}
.toast-success { background: #2d6cdf; }
.toast-error   { background: #d9534f; }
/* 右上角：top/right 16px，transform: translateX(120%) 初始在屏幕右侧外，加 .toast-show 滑入；停留 1.5s 后滑出，允许堆叠（每个偏移 40px） */
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
#recentPathsDropdown .recent-path-expand {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    min-width: 0;
    padding: 0;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #999;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    border-radius: 4px;
}
#recentPathsDropdown .recent-path-expand:hover { background: rgba(255, 255, 255, 0.12); color: #e0e0e0; }
#recentPathsDropdown .recent-path-item.expanded .recent-path-label {
    white-space: normal;
    word-break: break-all;
    overflow: visible;
    text-overflow: clip;
}
#recentPathsDropdown .recent-path-del {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    min-width: 0;
    padding: 0;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #999;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    border-radius: 4px;
}
#recentPathsDropdown .recent-path-del:hover { background: rgba(255, 80, 80, 0.18); color: #ff6b6b; }
.recent-path-item:hover { background: rgba(255, 255, 255, 0.08); }
.dropdown-menu {
    display: none;
    position: fixed;
    z-index: 1000;
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    min-width: 160px;
    padding: 4px 0;
    font-size: 13px;
    color: #e0e0e0;
    max-height: 60vh;
    overflow-y: auto;
}
.dropdown-menu.open { display: block; }
.dropdown-empty { padding: 6px 10px; color: #888; white-space: nowrap; }
```

- [ ] **Step 3: 从 index.html 删除 `<style>` 块**

在 `public/index.html` 中，删除第 12 行 `<style>` 到第 112 行 `</style>`（含这两行）之间的整段，使 `<head>` 中仅保留：

```html
    <link rel="stylesheet" href="./xterm/css/xterm.css">
    <link rel="stylesheet" href="./styles.css">
    <script src="./addon-web-links/lib/addon-web-links.js"></script>
    <script src="./addon-unicode11/lib/addon-unicode11.js"></script>
    <script src="./term-session.js"></script>
```

操作后第 12 行起应为 `</head>`（原第 113 行），中间不再有 `<style>` 块。

- [ ] **Step 4: 验证迁移正确**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
grep -c "<style>" public/index.html
grep -c "\.toast {" public/styles.css
grep -c "\.dropdown-empty" public/styles.css
```
Expected: 第一个 `grep` 输出 `0`（index.html 已无 `<style>` 块）；后两个 `grep` 各输出 `1`（styles.css 已含这些规则）。Toast 复制提示、最近路径下拉、设置弹窗样式与迁移前一致（可用浏览器刷新后肉眼核对）。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add public/index.html public/styles.css
git commit -m "style: 将 index.html 内联 <style> 块迁入 styles.css"
```

---

### Task 3: 修复终端字体（加 fontFamily，消灭宋体 / 错位）

**Files:**
- Modify: `public/term-session.js:45`（构造函数增加 `fontFamily`）

**Interfaces:**
- 无依赖、无产出；仅 xterm `Terminal` 构造选项增加一项。
- `Unicode11Addon` 保持加载（第 48–49 行 `loadAddon(new Unicode11Addon.Unicode11Addon())` + `unicode.activeVersion = '11'` 不动），确保与服务端 headless 终端宽度规则一致、重连整屏对齐。

- [ ] **Step 1: 定位当前构造代码**

`public/term-session.js` 第 44–46 行当前为：

```js
        // 创建 xterm
        this.term = new Terminal({ allowProposedApi: true });
        this.term.open(this.wrapper);
```

- [ ] **Step 2: 增加 fontFamily 选项**

将第 45 行改为：

```js
        this.term = new Terminal({
            allowProposedApi: true,
            fontFamily: 'Consolas, "Microsoft YaHei", monospace'
        });
```

- [ ] **Step 3: 验证改动**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
grep -n "fontFamily" public/term-session.js
grep -n "Unicode11Addon" public/term-session.js
```
Expected: 第一个 `grep` 输出 `this.term = new Terminal({` 下方含 `fontFamily: 'Consolas, "Microsoft YaHei", monospace'`；第二个 `grep` 仍显示 `loadAddon(new Unicode11Addon.Unicode11Addon())` 与 `unicode.activeVersion = '11'`（未被改动）。

- [ ] **Step 4: 浏览器验证（手动）**

用 Windows 浏览器打开 RemoteCMD 终端页面，刷新：
- 中文输出（如 `Get-ChildItem`、含中文路径）不再显示宋体，呈微软雅黑（干净无衬线）。
- 中英文混排、CJK 字符与 ASCII 对齐正常，无错位 / 异常间距。
- 安卓真机照常（应原本就正常）。
- 杀掉前端刷新重连，整屏对齐正常（确认 Unicode11Addon 双端加载未被破坏）。
若仍有极轻微间距问题，记录现象，本计划不处理（留待后续评估 `lineHeight` / `letterSpacing`）。

- [ ] **Step 5: Commit**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add public/term-session.js
git commit -m "fix: 终端加 fontFamily，Windows 中文不再宋体且对齐正常"
```

---

## Self-Review 记录

- **Spec 覆盖**：① 删除散落文件 → Task 1；② 样式迁移 → Task 2；③ 终端字体 → Task 3。三项均覆盖，Global Constraints 含"不重启后端 / 不动 server.js / 保留 Unicode11Addon / 不迁移内联 style / 不引 webfont / 删前 ls 复核"。
- **Placeholder 扫描**：无 TBD/TODO；每步均含实际命令或可粘贴代码。
- **类型 / 命名一致**：`fontFamily` 字符串在 Task 3 定义与验证 grep 一致；`<style>` 块内容在 Task 2 Step 2 完整给出、Step 3 删除、Step 4 验证数量一致。
- **无遗漏**：spec "不在范围" 四项均在本计划 Global Constraints 中明确排除，未生成对应任务。
