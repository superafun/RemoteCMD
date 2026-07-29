# 飞书设置界面重排（独立分组 + ℹ 说明）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设置弹窗里「通知」分组内、嵌套在「系统通知（OS 窗口）」那行内部的飞书两行，抽取成独立分组「飞书通知（任务完成推送）」，并给分组标题 + 每个字段加 ℹ 信息图标（桌面 hover、手机 tap 弹出中文说明）。功能逻辑完全不变（4 个 input/select 的 id 全部保留，`applySettingsFeishu()` 与回填逻辑照常工作）。

**Architecture:** 纯前端改动，仅动 `public/index.html`（设置弹窗 HTML 构造段 + 顶部新增一段全局监听器）与 `public/styles.css`（新增 `.info` / `.info-tip` 样式）。后端 `server.js` 零改动。

**Tech Stack:** 原生浏览器 JS（无构建、无框架）；CSS tooltip（自建模态，不依赖原生 `title`）；单文件 `public/index.html`（CRLF）。

**Spec:** `docs/superpowers/specs/2026-07-22-feishu-settings-redesign-design.md`（已与用户确认，中文文案已定）。

## Global Constraints

- **功能不变**：飞书 4 个控件 id（`settingsFeishuAppIdInput` / `settingsFeishuAppSecretInput` / `settingsFeishuReceiveIdInput` / `settingsFeishuReceiveTypeInput`）与 `btn-apply-feishu` / `hint-feishu` 全部保留原样，位置可移动但 DOM id 不变。`applySettingsFeishu()`、连接时回填（index.html:362-365）、WS 同步逻辑一律不动。
- **中文走 `\u` 转义**：`public/index.html` 是含大量中文 UI 文案的文件，Edit/Write 工具会把中文写成 U+FFFD 或 `?`。凡涉及中文的插入，**必须用纯 ASCII Node 脚本、中文走 `\u` 转义**改文件，写完校验 `fffd=0` 且 `kana=0`（假名 0x3040–0x30FF 计数=0）。`public/styles.css` 的 CSS 规则不含中文（tooltip 文字来自 HTML），可用 Edit 工具直接加（仅 ASCII）。
- **CRLF 保持**：`index.html` 原文件 CRLF。脚本读取后 `.replace(/\r\n/g,'\n')` 统一处理，写回前 `s.split('\n').join('\r\n')` 还原，避免混入 LF。
- **ℹ 交互统一一套**：桌面 `:hover` 显示、手机 `tap` 显示，用同一个 `.info` 机制（自建模态气泡），不依赖原生 `title` 作唯一手段，不做桌面/手机媒体查询分两套。
- **全局监听器只注册一次**：手机 tap 切换 `.info.active` 的 `document` 级 click 监听器必须在脚本顶层注册**一次**，绝不能放进任何 ws 消息分支或事件回调内部（否则每次收消息重复注册）。
- **div 平衡**：设置弹窗用 `html += '<div ...>'` 字符串拼接构造，编辑后整段模板里 `<div` 与 `</div>` 出现次数必须相等（已验证基准 70/70，预期编辑后 74/74）。

## File Structure

- `public/index.html` — 设置弹窗构造段（~line 293-309 的飞书两行 → 抽取并改为独立 `modal-group` 插到 `// end 通知` 之后）；顶部新增一段 `document` 级 click 监听器（仅一次）。
- `public/styles.css` — 在 modal 样式段新增 `.info` 与 `.info-tip` 规则（hover/tap 气泡）。
- （可选）`tests/feishu-settings-smoke.mjs` — Playwright 冒烟，校验新分组存在、ℹ 图标存在、tap 能切换 `active`、旧 id 仍可被回填。

---

### Task 1: 抽取飞书为独立 modal-group（字节级 Node 脚本，中文 \u 转义）

**Files:**
- Modify: `public/index.html` （设置弹窗构造段，飞书两行在 ~line 293-309，嵌套于「系统通知（OS 窗口）」那行 modal-row 内；目标插入锚点 `html += '</div>'; // end 通知` 在 ~line 325）

**Interfaces:**
- Consumes: 现有构造段里 `settingsFeishuAppIdInput` 等 4 个 id 及其 `applySettingsFeishu()` / 回填逻辑（不动）。
- Produces: 新的独立 `modal-group`（class=`modal-group`，标题 class=`modal-group-title`），含分组标题 ℹ + 4 个带 ℹ 的字段行；旧的内联飞书块被移除；`// end 通知` 之后紧接新分组。

- [ ] **Step 1: 写字节级编辑脚本 `_feishu_reorg.js`**（纯 ASCII，中文全部 `\u` 转义）

脚本要点（与已验证的原型 `_test_edit.js` 一致，仅把 `feishu-group`/`group-title` 改为仓库既有 `modal-group`/`modal-group-title`，并把 ℹ 改为嵌套 `.info-tip` 子元素以支持文字换行）：

```js
const fs = require('fs');
const src = 'public/index.html';
let s = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');

// 定位：飞书 AppId 所在的那行 modal-row 的开头（即「系统通知」行内部的飞书块起点）
const OPEN = "html += '<div class=\"modal-row\">';";
const CLOSE = "html += '</div>';";
const credOpener = s.lastIndexOf(OPEN, s.indexOf('settingsFeishuAppIdInput'));
const receiveClose = s.indexOf(CLOSE, s.lastIndexOf(OPEN, s.indexOf('settingsFeishuReceiveIdInput')));
const removeEnd = receiveClose + CLOSE.length;
// 删除两个飞书 modal-row（保留其后关「系统通知」行的那个 </div>）
s = s.slice(0, credOpener) + s.slice(removeEnd);

// 中文（\u 转义）
const zh = {
  groupTitle:    '\u98DE\u4E66\u901A\u77E5\uFF08\u4EFB\u52A1\u5B8C\u6210\u63A8\u9001\uFF09',
  tipGroup:      '\u4EFB\u52A1\u5B8C\u6210\u65F6\uFF0C\u98DE\u4E66\u4F1A\u5411\u8FD9\u91CC\u914D\u7F6E\u7684\u8D26\u53F7\u6216\u7FA4\u53D1\u4E00\u6761\u6D88\u606F\u901A\u77E5\u4F60\u3002',
  tipAppId:      '\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u521B\u5EFA\u5E94\u7528\u540E\u5F97\u5230\u7684 app_id\u3002',
  tipAppSecret:  '\u5E94\u7528\u5BC6\u94A5\uFF0C\u4EC5\u670D\u52A1\u7AEF\u4F7F\u7528\uFF0C\u7528\u4E8E\u6362\u53D6\u8BBF\u95EE\u4EE4\u724C\u3002',
  tipReceiveId:  '\u6D88\u606F\u53D1\u7ED9\u8C01\uFF1A\u90AE\u7BB1\u3001\u7FA4 chat_id\uFF0C\u6216\u67D9\u4EBA open_id / user_id\u3002',
  tipReceiveType:'\u63A5\u6536 ID \u7684\u7C7B\u578B\u3002\u63A8\u8350 chat_id\uFF1A\u628A\u673A\u5668\u4EBA\u52A0\u8FDB\u7FA4\u5373\u53EF\u3002',
  receiveIdPh:   '\u4F60\u7684\u90AE\u7BB1 / \u7FA4 chat_id / open_id',
  emailOpt:      '\u90AE\u7BB1(email)',
  chatOpt:       '\u7FA4(chat_id)',
  apply:         '\u5E94\u7528'
};

// ℹ 图标：可见的 i 圆点 + 嵌套 .info-tip 气泡（文字中文）
function info(tip) { return '<span class="info">i<span class="info-tip">' + tip + '</span></span>'; }

const block = [
  "            html += '<div class=\"modal-group\">'",
  "            html += '<div class=\"modal-group-title\">" + zh.groupTitle + info(zh.tipGroup) + "</div>'",
  "            html += '<div class=\"modal-row\">'",
  "            html += '<label class=\"modal-label\">App ID" + info(zh.tipAppId) + "</label>'",
  "            html += '<input type=\"text\" id=\"settingsFeishuAppIdInput\" placeholder=\"app_id\" style=\"flex:1;min-width:160px;\">'",
  "            html += '</div>'",
  "            html += '<div class=\"modal-row\">'",
  "            html += '<label class=\"modal-label\">App Secret" + info(zh.tipAppSecret) + "</label>'",
  "            html += '<input type=\"password\" id=\"settingsFeishuAppSecretInput\" placeholder=\"app_secret\" style=\"flex:1;min-width:160px;\">'",
  "            html += '</div>'",
  "            html += '<div class=\"modal-row\">'",
  "            html += '<label class=\"modal-label\">\u63A5\u6536 ID" + info(zh.tipReceiveId) + "</label>'",
  "            html += '<input type=\"text\" id=\"settingsFeishuReceiveIdInput\" placeholder=\"" + zh.receiveIdPh + "\" style=\"flex:1;min-width:160px;\">'",
  "            html += '</div>'",
  "            html += '<div class=\"modal-row\">'",
  "            html += '<label class=\"modal-label\">\u63A5\u6536\u7C7B\u578B" + info(zh.tipReceiveType) + "</label>'",
  "            html += '<select id=\"settingsFeishuReceiveTypeInput\" onchange=\"applySettingsFeishu()\" style=\"flex:0 0 auto;\">'",
  "            html += '<option value=\"email\">" + zh.emailOpt + "</option>'",
  "            html += '<option value=\"chat_id\">" + zh.chatOpt + "</option>'",
  "            html += '<option value=\"open_id\">open_id</option>'",
  "            html += '<option value=\"user_id\">user_id</option>'",
  "            html += '</select>'",
  "            html += '<button class=\"btn-primary\" id=\"btn-apply-feishu\" onclick=\"applySettingsFeishu()\">" + zh.apply + "</button>'",
  "            html += '<span id=\"hint-feishu\" class=\"apply-hint\"></span>'",
  "            html += '</div>'",
  "            html += '</div>'; // end feishu modal-group"
].join('\n');

// 插入到「通知」分组结束后（锚点含中文，用 \u 转义匹配）
const anchor = "html += '</div>'; // end \u901A\u77E5";
const ai = s.indexOf(anchor);
if (ai === -1) throw new Error('end \u901A\u77E5 anchor not found');
s = s.slice(0, ai + anchor.length) + '\n' + block + '\n' + s.slice(ai + anchor.length);

// 校验
const openCount = (s.match(/<div/g) || []).length;
const closeCount = (s.match(/<\/div>/g) || []).length;
let fffd = 0, kana = 0;
for (const ch of s) { const c = ch.codePointAt(0); if (c === 0xFFFD) fffd++; if (c >= 0x3040 && c <= 0x30FF) kana++; }
if (openCount !== closeCount) throw new Error('div 不平衡: ' + openCount + ' vs ' + closeCount);
if (fffd !== 0) throw new Error('出现 U+FFFD: ' + fffd);
if (kana !== 0) throw new Error('出现假名范围字符: ' + kana);
if (!s.includes(zh.groupTitle)) throw new Error('分组标题未注入');
if (s.slice(0, s.indexOf('end \u901A\u77E5')).includes('settingsFeishuAppIdInput')) throw new Error('旧内联飞书块未移除');

// 还原 CRLF 写回
fs.writeFileSync(src, s.split('\n').join('\r\n'), 'utf8');
console.log('OK div', openCount + '/' + closeCount, 'fffd', fffd, 'kana', kana);
```

- [ ] **Step 2: 运行脚本并校验**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node _feishu_reorg.js`
Expected: 输出 `OK div 74/74 fffd 0 kana 0`（基准 70/70 → 删 2 行 + 插 6 行净增 4 对 = 74/74）。

- [ ] **Step 3: 语法 + 编码自检**

Run:
```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
node --check public/index.html 2>/dev/null || echo "index.html 非纯 JS，跳过 node --check（由 div 平衡+fffd 校验保证结构）"
git diff --stat public/index.html
```
Expected: diff 显示飞书块已从「系统通知」行内消失、出现在 `// end 通知` 之后；`grep -c "settingsFeishuAppIdInput" public/index.html` 仍为 2（定义 + 回填，未被破坏）。

- [ ] **Step 4: 清理临时脚本并提交**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
rm -f _feishu_reorg.js _test_edit.js public/index.copy.html
git add public/index.html
git commit -m "refactor: 飞书设置抽取为独立分组（modal-group）+ ℹ 说明占位"
```

---

### Task 2: 新增 .info / .info-tip 样式（styles.css，Edit 工具，纯 ASCII）

**Files:**
- Modify: `public/styles.css` （紧跟 `.modal-label { ... }` 块，~line 138 之后）

**Interfaces:**
- Consumes: 仓库既有 `.modal-group` / `.modal-group-title` / `.modal-row` / `.modal-label` 视觉约定（标题色 `#6fb3e0`、标签色 `#c0c0c0`）。
- Produces: `.info`（可见小圆点 i 图标，`position: relative` 以便气泡定位）、`.info-tip`（绝对定位气泡，`opacity/visibility` 控制显隐，`:hover` 与 `.active` 两种触发态）、`.info-tip` 文字换行（`white-space: normal; max-width`）。

- [ ] **Step 1: 在 `.modal-label` 块之后插入样式**

在 `public/styles.css` 的 `.modal-label { ... }`（~line 132-138）块结束后新增：

```css
        /* 设置项 ℹ 信息图标 + 气泡说明（桌面 hover / 手机 tap 统一一套） */
        .info {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            margin-left: 6px;
            border-radius: 50%;
            background: #6fb3e0;
            color: #111;
            font-size: 10px;
            font-weight: 700;
            font-style: normal;
            line-height: 1;
            cursor: help;
            vertical-align: middle;
            position: relative;
        }
        .info-tip {
            position: absolute;
            left: 50%;
            top: 140%;
            transform: translateX(-50%);
            background: #1b1b1b;
            color: #e6e6e6;
            border: 1px solid #444;
            padding: 6px 8px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.4;
            width: max-content;
            max-width: 240px;
            white-space: normal;
            text-align: left;
            z-index: 50;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.12s;
            pointer-events: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }
        .info:hover .info-tip,
        .info.active .info-tip {
            opacity: 1;
            visibility: visible;
        }
```

> 说明：`.info` 用 `position: relative`，气泡相对图标定位；`max-width: 240px` + `white-space: normal` 保证中文长说明换行。桌面 `:hover` 直接显隐；手机 tap 由 Task 3 的 `document` 监听器切换 `.active` 实现，CSS 不区分设备。

- [ ] **Step 2: 提交**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add public/styles.css
git commit -m "feat: 新增设置项 ℹ 信息图标与气泡说明样式"
```

---

### Task 3: 手机 tap 切换 .info.active（顶层 document 监听器，仅注册一次）

**Files:**
- Modify: `public/index.html` （脚本顶层，紧接现有 `window.addEventListener('error'/'unhandledrejection')` 段之后，~line 1225 附近；务必在顶层、不在任何消息分支内）

**Interfaces:**
- Consumes: 现有 DOM（`.info` 元素由 Task 1 生成）。
- Produces: 全局 `document` 级 `click` 监听器（一次），点击 `.info` 切换其 `.active`，点击其它处关闭所有已激活的 `.info`。

- [ ] **Step 1: 顶部新增全局监听器**

在 `public/index.html` 顶层（`window.addEventListener('unhandledrejection', ...)` 块之后）新增：

```js
// 设置项 ℹ 图标：手机 tap 切换说明气泡（桌面用 CSS :hover）。
// 必须在顶层只注册一次，不能放进 ws 消息分支内（否则每次收消息重复注册）。
document.addEventListener('click', function (e) {
    var t = (e.target && e.target.closest) ? e.target.closest('.info') : null;
    document.querySelectorAll('.info.active').forEach(function (el) {
        if (el !== t) el.classList.remove('active');
    });
    if (t) t.classList.toggle('active');
});
```

> 注意：`e.target.closest('.info')` 也会命中嵌套的 `.info-tip` 文字（它在 `.info` 内部），因此点击气泡内文字仍视为点击该图标，不会误关。点别处关闭所有，符合「tap 弹出 / 再 tap 或点别处收起」。

- [ ] **Step 2: 自检监听器唯一 + 提交**

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && grep -c "addEventListener('click'" public/index.html`（仅作存在性参考，重点确认该段不在 `ws.onmessage` / `else if` 分支内）
Expected: 在顶层只出现一次该 `document.addEventListener('click', ...)` 块（可用 `grep -n "closest('.info')" public/index.html` 确认仅 1 处，且上下文非消息分支）。

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add public/index.html
git commit -m "feat: 飞书 ℹ 图标手机 tap 切换说明气泡（顶层监听器）"
```

---

### Task 4: 验证（手动真机 + 可选 Playwright 冒烟）

**Files:**
- Test（可选）: `tests/feishu-settings-smoke.mjs` （新建，Playwright 冒烟）

**Interfaces:**
- Consumes: 运行中服务器（`npm run start`，默认 `http://localhost:<端口>`）；`playwright`（`npx playwright` 可用）。
- Produces: 验证报告（控制台输出）。

- [ ] **Step 1: 手动真机验证（主）**

1. `npm run restart`（确保带新代码运行）。
2. 安卓真机浏览器开 `http://<本机IP>:<端口>`，打开设置弹窗。
3. 确认「通知」分组下方出现独立分组「飞书通知（任务完成推送）」，含 App ID / App Secret / 接收 ID / 接收类型 四行，每行标签右侧有 ℹ 图标；分组标题右侧也有 ℹ。
4. 桌面（或手机长按/hover）：点按/悬停 ℹ，应弹出对应中文说明气泡；点别处或再点收起。
5. 在「接收 ID」填入测试值、「接收类型」选 chat_id，点「应用」：确认 `hint-feishu` 显示成功提示（功能未坏），且 `applySettingsFeishu()` 正常（与改动前一致）。
6. 关闭弹窗重开：确认填入值仍在（回填逻辑 `settingsFeishu*Input` 仍生效）。
7. 确认「系统通知（OS 窗口）」那行未被破坏（飞书已从其中抽出，该行仍独立显示）。

- [ ] **Step 2（可选）: Playwright 冒烟**

`tests/feishu-settings-smoke.mjs`：

```js
import { chromium } from 'playwright';
const base = 'http://localhost:<端口>';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(base, { waitUntil: 'networkidle' });

// 打开设置弹窗（按现有 UI 触发，例如点击设置按钮）——此处用键盘无涉，直接 evaluate 触发弹窗函数
await page.evaluate(() => { if (typeof openSettings === 'function') openSettings(); });
await page.waitForTimeout(300);

const groupTitle = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.modal-group-title')];
  const t = els.find(e => e.textContent.includes('飞书通知'));
  return t ? t.textContent : null;
});
const infoCount = await page.evaluate(() => document.querySelectorAll('.info').length);
const idsOk = await page.evaluate(() => {
  return ['settingsFeishuAppIdInput','settingsFeishuAppSecretInput','settingsFeishuReceiveIdInput','settingsFeishuReceiveTypeInput']
    .every(id => !!document.getElementById(id));
});
// tap 切换 active
const tapWorks = await page.evaluate(() => {
  const i = document.querySelector('.info');
  if (!i) return false;
  i.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return i.classList.contains('active');
});
console.log('分组标题:', groupTitle);
console.log('ℹ 图标数:', infoCount);
console.log('飞书 4 id 齐全:', idsOk);
console.log('tap 切换 active:', tapWorks);
console.log('页面错误:', errors.length ? errors : '无');
await browser.close();
const ok = !!groupTitle && infoCount >= 5 && idsOk && tapWorks && errors.length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
```

Run: `cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD && node tests/feishu-settings-smoke.mjs`
Expected: `SMOKE PASS`（分组标题含「飞书通知」、ℹ ≥5 个、4 个 id 都在、tap 能切 active、无页面错误）。

- [ ] **Step 3: 提交测试脚本（若执行了 Step 2）**

```bash
cd /c/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD
git add tests/feishu-settings-smoke.mjs
git commit -m "test: 飞书设置重排冒烟验证"
```

---

## Self-Review 对照 spec

- spec「飞书独立分组」→ Task 1 抽成 `modal-group`「飞书通知（任务完成推送）」，插在「通知」之后，符合。
- spec「每字段一行 + 标签旁 ℹ」→ Task 1 4 个 modal-row 各含 label + `.info`，符合。
- spec「分组标题 ℹ 说明整体用途」→ Task 1 标题内 `info(tipGroup)`，符合。
- spec「保留应用按钮」→ `btn-apply-feishu` 仍在接收类型行，符合。
- spec「功能逻辑不变」→ 4 个 id 全保留、`applySettingsFeishu()` 与回填逻辑未动，符合。
- spec「说明不常驻明文，hover/tap 显示」→ Task 1 文案进 `.info-tip`；Task 2 样式 hover/active；Task 3 手机 tap 切换，符合。
- spec「中文文案已定」→ Task 1 `zh` 全部采用 spec 确认文案（`\u` 转义），符合。
- 编码安全：Task 1 用 `\u` 脚本 + `fffd=0`/`kana=0` 校验；Task 2 CSS 纯 ASCII；Task 3 监听器纯 ASCII，符合本仓库 CJK 字节级铁律。
- 无占位符、无 TODO。类型/id 一致：4 个 input id 在 Task 1 定义、回填逻辑（既有）消费、Task 4 冒烟校验，全程一致。

---

## 实现后清理

- 删除所有临时调试脚本：`_feishu_reorg.js`、`_test_edit.js`、`public/index.copy.html`（已在 Task 1 Step 4 删除）。
- 不改动 `server.js`、不改动飞书 WS 同步逻辑、不新增测试消息按钮（spec 明确不加）。
