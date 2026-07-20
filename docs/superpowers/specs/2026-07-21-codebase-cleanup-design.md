# 代码清理三项：散落文件删除 / 样式迁移 / 终端字体修复

**日期：** 2026-07-21
**状态：** 设计已确认，待写实现计划

## 背景与目标

用户提出三项清理 / 修复（均只涉及前端与散落产物，**不需要重启后端**，改完刷新浏览器即可）：

1. **删除散落文件**：项目根目录与若干工具目录里残留大量临时 / 测试 / 截图文件，要求清理让仓库干净。
2. **样式迁移**：`public/index.html` 里有一整块 `<style>`（toast / recent-path / dropdown 样式，约 100 行）未归入 `public/styles.css`，迁移以规范结构。
3. **终端字体修复**：Windows 浏览器上 xterm 终端中文显示成宋体且错位，安卓正常。修复字体显示。

## 关键排查结论

- **宋体 / 错位根因**：`public/term-session.js` 的 `new Terminal({ allowProposedApi: true })` 未设 `fontFamily`，xterm 使用默认 `monospace`（见 `node_modules/@xterm/xterm` 的 `DEFAULT_OPTIONS.fontFamily: "monospace"`）。Windows 上 `monospace` 回退到 Courier New，中文再回退到**宋体**（衬线字体，字宽与计算值不一致 → 既宋体又错位）。安卓走原生干净等宽 + Noto 中文故正常。
- **Unicode11Addon 与字体无关**：官方定位是 "Updates character widths to their unicode11 values"（提供 Unicode 11 字符宽度规则，决定每字符占几格），不影响字体族选择。本项目在浏览器端与服务端 headless 终端**都**加载它，目的是双端宽度规则一致，重连序列化整屏才能对齐——"重连同步宽度一致"是双端同加载的副作用，不是 addon 官方用途。故：**不能删**（否则双端宽度不一致、重连整屏错位），也**删不掉宋体问题**。

## 方案一：删除散落文件

**范围**（均未被 git 跟踪，删除安全；不碰 `server.js` / `public` / `docs` / `node_modules` / 配置文件 / `.codebuddy` / `.opencode`）：

- 根目录 18 个文件：
  `_diag_recentpath.js`、`_tmp_diag_server.js`、`_wstest.js`、`_tmp_diag_server.log`、`bat_out.log`、
  `bug_recentpath_real.png`、`verify_recentpath_fix.png`、`inputbar-*.png`（8 张）、
  `after-reload.yml`、`base.yaml`、`check.yml`、`mobile.yml`、`reasonix.toml`
- 目录 `.playwright-cli/`（playwright 会话日志）
- 目录 `.superpowers/`（brainstorm 会话草图 + sdd 测试报告 / 截图 / diff）

**实施约束**：删除前再 `ls` 复核清单，确认不误删任何源码 / 配置 / 文档。纯资源清理，无需重启后端。

## 方案二：样式迁移（`<style>` 块 → styles.css）

- 将 `public/index.html` 第 12–112 行 `<style>…</style>` 整块（约 100 行：`.toast*`、`.recent-path-*`、`#recentPathsDropdown *`、`.dropdown-menu*`、`.dropdown-empty`）**原样追加**到 `public/styles.css` 末尾，选择器 / 注释 / 顺序不变。
- 从 `index.html` 删除该 `<style>` 块，仅保留两行 `<link rel="stylesheet">`。
- 散落在 JS 弹窗字符串里的内联 `style="…"`（约 40 处）**本次不动**（动态生成，抽成 class 收益低、易错，用户已确认暂不移）。
- 实施前核对 `styles.css` 当前无同名选择器重复。

仅前端，刷新即生效，无需重启后端。

## 方案三：终端字体修复（方案 A，系统字体栈）

- 改 `public/term-session.js` 第 45 行构造：
  ```js
  this.term = new Terminal({
    allowProposedApi: true,
    fontFamily: 'Consolas, "Microsoft YaHei", monospace'
  });
  ```
- 效果：Windows 英文走 Consolas、中文走**微软雅黑**（干净无衬线，非宋体，字宽正确 → 错位消失）；安卓走原生干净等宽 + Noto 中文。UI 不动、Unicode11Addon 保留。
- **零下载、零流量、不影响 WebSocket 终端数据传输**。若刷新后仍有极轻微间距问题，再评估 `lineHeight` / `letterSpacing`（本次先不动）。

## 验证

- **删除后**：`git status` 无散落文件、仓库干净；`node_modules` / `public` / `server.js` / `config.json` 完好。
- **样式迁移后**：Toast 复制提示、最近路径下拉、设置弹窗样式与迁移前一致（可对照既有截图 / 肉眼核对）。
- **字体修复后**：Windows 浏览器打开终端，中文不再宋体、无错位；安卓照常。
- **重连**：杀掉前端刷新重连，整屏对齐正常（确认 Unicode11Addon 双端加载未被动）。

## 风险与回滚

- 删除散落文件：仅未跟踪的临时产物，误删风险低；删除前复核清单。
- 样式 / 字体：仅前端静态资源，回滚 = `git checkout` 对应文件，无需后端重启。

## 不在范围

- 内联 `style="…"` 迁移（用户选择暂不动）。
- 自带 webfont 真统一（用户选方案 A 系统字体栈）。
- 删除 Unicode11Addon（会导致重连对齐错位，不删）。
- `docs/` 下 plan 文档清理（保留）。
