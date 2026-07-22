import { chromium } from 'playwright';

const base = 'http://localhost:65433';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function serverUp() {
  try {
    const res = await fetch(base, { method: 'GET' });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

let server = null;

async function ensureServer() {
  if (await serverUp()) {
    console.log('服务器已在运行，直接复用: ' + base);
    return;
  }
  console.log('服务器未响应，尝试后台启动 npm run start ...');
  const { spawn } = await import('node:child_process');
  server = spawn('npm', ['run', 'start'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    detached: false,
  });
  // 最多等待 15s 让端口起来
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await serverUp()) {
      console.log('服务器已启动: ' + base);
      return;
    }
  }
  throw new Error('服务器在 15s 内未能启动');
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

try {
  await ensureServer();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  // 打开设置弹窗（按现有 UI 触发，这里用键盘无关方式直接 evaluate 触发弹窗函数）
  await page.evaluate(() => { if (typeof openSettingsModal === 'function') openSettingsModal(); });
  await page.waitForTimeout(400);

  const groupTitle = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.modal-group-title')];
    const t = els.find(e => e.textContent.includes('飞书通知'));
    return t ? t.textContent.trim() : null;
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

  // strengthened: info-tip bubbles and new modal-content scroll wrapper
  const firstTipNonEmpty = await page.evaluate(() => {
    const t = document.querySelector('.info .info-tip');
    return !!t && t.textContent.trim().length > 0;
  });
  const hasAppIdTip = await page.evaluate(() => {
    return [...document.querySelectorAll('.info-tip')].some(e => e.textContent.includes('app_id'));
  });
  const hasModalContent = await page.evaluate(() => !!document.querySelector('.modal-content'));
  console.log('first info-tip non-empty:', firstTipNonEmpty);
  console.log('info-tip contains app_id:', hasAppIdTip);
  console.log('modal-content wrapper present:', hasModalContent);

  const ok = !!groupTitle && infoCount >= 5 && idsOk && tapWorks && firstTipNonEmpty && hasAppIdTip && hasModalContent && errors.length === 0;
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('SMOKE ERROR:', e);
  await browser.close();
  process.exit(2);
}
