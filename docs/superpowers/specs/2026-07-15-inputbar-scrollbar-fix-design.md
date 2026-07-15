# 底部输入条纵向滚动条修复设计

## 背景

底部输入条 `#inputBarText` 在空内容、单行、多行下都恒出现纵向滚动条。用户要求：空内容/正常行数下不应有滚动条；超过 8 行（160px）保留可滚动行为（max-height 保留）。

## 根因（实测，非猜测）

通过 Playwright 实测 `#inputBarText` 在 5 种内容下的尺寸：

| 内容 | scrollHeight | clientHeight | offsetHeight | height_inline | 滚动条 | 差值 |
|------|---|---|---|---|---|---|
| `""` 空 | 30 | 28 | 30 | 30px | 有 | 2 |
| `"abc"` 单行 | 30 | 28 | 30 | 30px | 有 | 2 |
| `"a\nb"` 2 行 | 53 | 51 | 53 | 53px | 有 | 2 |
| `"a\nb\nc"` 3 行 | 75 | 73 | 75 | 75px | 有 | 2 |
| 8 行 | 187 | 158 | 160 | 187px | 有 | 29 |

**冲突机制**：

1. `autoGrow(ta)`（[public/index.html L1232-L1235](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/index.html#L1232-L1235)）写 `ta.style.height = ta.scrollHeight + 'px'`
2. `#inputBarText` 在 [public/styles.css L267](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css#L267) 设置了 `box-sizing: border-box`（commit 3c418a6 引入，"与 .modal-box input 统一标准"）
3. Chrome 在 `border-box` 下 `scrollHeight` **包含 border**（30 = content + padding + 2×1px border）
4. `clientHeight` 在 `border-box` 下**不含 border**（28 = 30 − 2）
5. `height = 30px` → `clientHeight = 28 < scrollHeight = 30` → Chrome 判定溢出 2px → 永远显示滚动条
6. 差值恒 = `borderTop(1) + borderBottom(1) = 2px`，与内容无关 → 空内容也触发

第 5 行（8 行内容）差值 29 是真实溢出：`scrollHeight(187) > max-height(160)`，触发 max-height 截断后 `clientHeight=158 < scrollHeight=187`，滚动条合理存在。

## 修复方案

**删 `#inputBarText` 的 `box-sizing: border-box`**（[public/styles.css L267](file:///c:/Users/fmy3/OneDrive/project/pythonProjectRemoteCMD/public/styles.css#L267)）。

改回 textarea 默认 `content-box`：

- `scrollHeight` 不含 border（28 = content + padding）
- `height = 28px` → `clientHeight = 28 = scrollHeight` → 无溢出 → 无滚动条
- 多行内容正常撑开，未超 max-height 时永远 `clientHeight == scrollHeight`
- 超 8 行触发 `max-height: 160px` 截断，仍可滚动（保留方案 A）

**1 行 CSS 改动**，不动 JS、不动协议、不动 server.js。

## 影响 / 取舍

- **textarea 实际宽度变化 2px**：`content-box` 下 border 算在 width 之外，textarea 总宽 = flex 分配宽 + 2px border。视觉上输入框右边可能与"换行"按钮紧贴关系略有变化，需肉眼确认。
- **commit 3c418a6 的"统一标准"被推翻**：`.modal-box input` 保留 `border-box`（单行 input 不走 autoGrow，无此冲突）。`#inputBarText` 单独走 `content-box`。统一标准本就不必要——两种元素行为不同（一个走 scrollHeight 撑高，一个固定高度），不该强行统一 box-sizing。
- **`outline: none` 保留**：commit 3c418a6 同 commit 加的 `outline: none` 是为了修 Chrome focus 白色焦点环（独立 bug），与本次滚动条无关，保留不动。

## 验证

Playwright 实测：

1. 删 border-box 后重测 5 种内容，断言前 4 种 `scrollHeight === clientHeight`（无滚动条）
2. 第 5 种（8 行）仍 `scrollHeight > clientHeight`（保留滚动条）
3. 截图肉眼确认 textarea 与左右按钮对齐无回归

## 性能影响

纯 CSS 1 行改动，无 JS 逻辑变化、无 DOM 变化、无新增监听器。可忽略。
