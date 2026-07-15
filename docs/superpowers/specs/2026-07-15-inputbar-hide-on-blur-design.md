# 输入条「焦点丢失隐藏」改为可设置项 + Esc/换行隐藏交互调整

日期：2026-07-15

## 背景

当前输入条的交互逻辑：

- 焦点丢失（`blur`）时**无条件**隐藏输入条并保留草稿（`closeInputBarPreserve()`，见 `public/index.html:1403-1408`）。
- `Esc` 键**无条件**清空内容但保持展开（`clearInputBar()`，见 `public/index.html:1396`）。
- 换行按钮在内容为空时 `closeInputBar()` 隐藏（见 `public/index.html:1363`，已是目标行为，无需改动）。

用户需求：

1. 把「焦点丢失隐藏输入条」从写死行为改为**可设置开关**，放进设置弹窗（与其他设置一致，多端同步）。
2. `Esc` 行为调整：**有内容时清空内容；无内容时隐藏输入条**。
3. 换行按钮空内容隐藏输入条：已具备，保持不变。

补充约束（用户 2026-07-15 明确）：Esc 的清空/隐藏**只在焦点位于输入条内时生效**，焦点不在输入条时完全不处理（走终端正常 Esc 转发）。当前 `Esc` 监听绑定在 `inputBarText`（输入框自身）的 `keydown` 上，天然满足该约束，不新增任何全局 Esc 拦截。

## 目标

- 新增开关 `inputBarHideOnBlur`（焦点丢失时隐藏输入条），默认 `true`，保持当前默认行为（向后兼容）。
- 完整接入现有多端同步链路：`config.json` 默认值 + 兜底 + 连接下发 + WS 双向 + 设置变更广播 + 前端接收侧更新。
- 调整 Esc 交互为「有内容清空 / 无内容隐藏」。
- 改动量小、复用现有模式，不引入新的架构或抽象。

## 非目标（YAGNI）

- 不改动换行按钮已有逻辑。
- 不新增全局键盘监听。
- 不引入主题/样式以外的任何额外设置项。

## 设计

### 设置项定义

| 项 | 值 |
| --- | --- |
| 配置键 | `inputBarHideOnBlur` |
| WS 消息类型 | `input_bar_hide_on_blur` |
| 类型 | `boolean` |
| 默认值 | `true` |
| 同步方式 | 服务端权威 + 全量广播（与其他设置一致） |
| 设置弹窗位置 | 「输入条动作」分组最前（checkbox 置顶规则） |
| 应用方式 | 勾选即时生效（`onchange` 直接 `wsSend`），无「应用」按钮 |

### 1. 服务端改动（server.js）

- `loadConfig()`（line 9-72）：
  - 默认值对象新增 `inputBarHideOnBlur: true`（与 `inputBarCloseAfterSend` 等并列，约 line 30 附近）。
  - 兜底分支新增：`if (typeof cfg.inputBarHideOnBlur !== 'boolean') cfg.inputBarHideOnBlur = true;`（与 line 69 同区域）。
- 连接下发（line 209-212 区域）：新增一条
  `ws.send(JSON.stringify({ type: 'input_bar_hide_on_blur', data: config.inputBarHideOnBlur }));`
- 消息处理（line 317-340 区域，紧邻 `input_bar_close_after_send` 分支）：新增
  ```js
  else if (type === 'input_bar_hide_on_blur') {
      if (typeof data !== 'boolean') return;
      config.inputBarHideOnBlur = data;
      broadcast({ type: 'input_bar_hide_on_blur', data: config.inputBarHideOnBlur });
      saveConfig(config);
  }
  ```

### 2. 前端变量与设置弹窗（public/index.html）

- 变量声明（line 82-85 区域）新增：`let inputBarHideOnBlur = true;`
- 「输入条动作」分组（line 227-259）最前面新增一行 checkbox（checkbox 置顶）：
  ```html
  <div class="modal-row">
    <label class="modal-label"><input type="checkbox" id="settingsInputBarHideOnBlurInput" onchange="applySettingsInputBarHideOnBlur()"> 焦点丢失时隐藏输入条</label>
    <span id="hint-inputBarHideOnBlur" class="apply-hint"></span>
  </div>
  ```
- 新增 apply 函数（与 `applySettingsInputBarCloseAfterSend` 约 line 508 同区域）：
  ```js
  function applySettingsInputBarHideOnBlur() {
      const v = document.getElementById('settingsInputBarHideOnBlurInput').checked;
      wsSend({ type: 'input_bar_hide_on_blur', data: v });
      flashHint('hint-inputBarHideOnBlur');
  }
  ```
- 设置弹窗打开回填（line 349 区域）新增：`document.getElementById('settingsInputBarHideOnBlurInput').checked = inputBarHideOnBlur;`
- WS 接收侧（line 885-894 区域）新增分支：
  ```js
  } else if (msg.type === 'input_bar_hide_on_blur') {
      inputBarHideOnBlur = msg.data;
      addFrontendLog('焦点丢失隐藏输入条同步为 ' + (inputBarHideOnBlur ? '隐藏' : '保持展开'), 'in');
  }
  ```

### 3. 交互逻辑改动（public/index.html）

- `blur` 监听（line 1403-1408）：加 `inputBarHideOnBlur` 开关门控——
  ```js
  inputBarText.addEventListener('blur', (e) => {
      if (inputBarWrap.style.display !== 'flex') return;   // 已关闭则忽略
      if (!inputBarHideOnBlur) return;                     // 设置关闭：失焦不隐藏
      const r = e.relatedTarget;
      if (r && inputBarWrap.contains(r)) return;            // 焦点仍在输入条内
      closeInputBarPreserve();                             // 关闭但保留草稿
  });
  ```
- `Esc` 监听（line 1396）：改为按是否有内容分流——
  ```js
  if (e.key === 'Escape') {
      e.preventDefault();
      if (inputBarText.value) clearInputBar();   // 有内容：清空、保持展开、焦点留输入框
      else closeInputBar();                       // 无内容：隐藏输入条
  }
  ```
  注意：该 `keydown` 监听绑定在 `inputBarText` 上，仅焦点在输入条内时触发，天然满足「其他时候不管」。
- 换行按钮空内容隐藏（line 1363）：已是目标行为，**不改**。

## 数据流向

```
用户勾选/取消「焦点丢失时隐藏输入条」
  → applySettingsInputBarHideOnBlur()
  → wsSend({type:'input_bar_hide_on_blur', data})
  → server.js 写 config + broadcast 全客户端 + saveConfig
  → 各客户端 WS 接收 → inputBarHideOnBlur = data → 日志
  → 后续 blur 事件按新开关门控
```

Esc 交互为纯前端行为，不依赖设置同步（`inputBarText.value` 实时判定）。

## 错误处理 / 边界

- 服务端对 `data` 做 `typeof boolean` 校验，非法值直接 `return` 不下发。
- 旧 `config.json` 缺字段时兜底为 `true`，不影响既有用户。
- 焦点不在输入条时 Esc 不触发清空/隐藏（监听作用域保证）。
- 关闭「焦点丢失隐藏」后，输入条仍可通过：关闭按钮（toggle）、空内容 Esc、空内容换行按钮 三种方式隐藏，不会卡死无法收起。

## 测试验证

1. **默认开（升级后现状）**：点外部/终端 → 输入条隐藏且保留草稿；有内容按 Esc → 清空保持展开；空内容按 Esc → 隐藏；换行按钮空内容 → 隐藏。
2. **设置中关闭并同步**：在 A 端关闭开关 → A、B 端日志均提示「保持展开」；失焦不再隐藏（焦点移出输入条后输入条常驻）。
3. **关闭后 Esc/换行仍可隐藏**：空内容按 Esc、空内容按换行按钮仍能将输入条收起。
4. **持久化**：刷新页面后开关状态保持（来自 `config.json` 下发）。
5. **焦点边界**：焦点在终端时按 Esc → 走终端正常 Esc，输入条不被清空/隐藏。

## 影响文件

- `server.js`：`loadConfig` 默认 + 兜底、连接下发、消息处理分支。
- `public/index.html`：变量声明、设置弹窗渲染、apply 函数、弹窗回填、WS 接收分支、blur 门控、Esc 分流。

不改动 `public/term-session.js`、`public/styles.css`、其他设置项逻辑。
