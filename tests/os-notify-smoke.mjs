import { chromium } from 'playwright';

const base = 'http://localhost:65433';
const browser = await chromium.launch();
// 用 granted 权限的 context，绕过系统授权弹窗，验证前端接线正确
const ctx = await browser.newContext({ permissions: ['notifications'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });

// 1) 函数存在
const hasFn = await page.evaluate(() => typeof window.fireOsNotification === 'function');
console.log('fireOsNotification 存在:', hasFn);

// 2) Notification API 可用（无头环境 permission 可能为 default/denied，仅作可用性检查，不阻塞）
const notifApi = await page.evaluate(() => 'Notification' in window);
console.log('Notification API 可用:', notifApi);

// 3) 打开设置弹窗后再查勾选框（checkbox 在弹窗 DOM 内，未开弹窗时不存在）
await page.evaluate(() => { if (typeof openSettingsModal === 'function') openSettingsModal(); });
await page.waitForTimeout(200);
const checked = await page.evaluate(() => {
  const el = document.getElementById('settingsBellOsEnabledInput');
  return el ? el.checked : null;
});
console.log('settingsBellOsEnabledInput 默认勾选:', checked);

// 4) 触发一次并确认不抛错（真实弹窗在无头环境可能不可见，但不报错即接线正确）
const triggered = await page.evaluate(() => {
  try { window.fireOsNotification(1); return true; } catch (e) { return String(e); }
});
console.log('fireOsNotification(1) 调用结果:', triggered);

console.log('页面错误:', errors.length ? errors : '无');
await browser.close();

// 钩子存在 + API 可用 + checkbox 默认勾选 + 触发不抛错 + 无页面错误
const ok = hasFn && notifApi && checked === true && triggered === true && errors.length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
