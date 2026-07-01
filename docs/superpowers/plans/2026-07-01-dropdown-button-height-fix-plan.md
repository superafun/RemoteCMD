# Dropdown 按钮高度不一致修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 session 下拉菜单按钮高度比工具栏按钮矮 2px 的问题。

**架构:** 仅修改 `public/styles.css` 中 `.dropdown-menu button` 的 CSS 规则，移除覆盖通用 `button` 样式的 `border: none; background: none;`，使 dropdown 按钮继承通用按钮的边框、背景和悬停效果。

**Tech Stack:** 纯 CSS，无 JS/HTML 变更

---

### Task 1: 修改 styles.css 中 dropdown 按钮样式

**Files:**
- Modify: `public/styles.css:192-203`

- [ ] **Step 1: 修改 `.dropdown-menu button` 样式**

  修改 `public/styles.css` 第 192-203 行：

  将：
  ```css
  .dropdown-menu button {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      color: #ccc;
      padding: 6px 14px;
  }
  .dropdown-menu button:hover {
      background: #333;
  }
  ```

  改为：
  ```css
  .dropdown-menu button {
      display: block;
      width: 100%;
      text-align: left;
      padding: 6px 14px;
      /* 继承通用 button 的 background、border、color、font-size */
  }
  .dropdown-menu button:hover {
      background: #505050;
      border-color: #6a6a6a;
  }
  ```

- [ ] **Step 2: 验证效果**

  1. 确认服务器已在运行（端口 65433）
  2. 在浏览器中访问 `http://localhost:65433/`
  3. 点击 session 下拉按钮
  4. 视觉确认下拉按钮高度与工具栏其他按钮一致（约 29.6px）
  5. 悬停确认背景色变成 `#505050`，边框变成 `#6a6a6a`

- [ ] **Step 3: 清理**

  删除临时对比页面：
  ```bash
  del public\button-height-comparison.html
  del docs\button-height-comparison.html