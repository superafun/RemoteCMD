import { chromium } from 'playwright';

const URL = 'http://localhost:65433';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await page.goto(URL, { waitUntil: 'networkidle' });

// 展开输入条
await page.click('#inputBarBtn');
await page.waitForSelector('#inputBarWrap', { state: 'visible' });

// 灌入多行文本并触发 autoGrow（input 事件）
await page.evaluate(() => {
  const ta = document.getElementById('inputBarText');
  ta.value = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(150);

const m = await page.evaluate(() => {
  const vh = window.innerHeight;
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const cs = (id) => getComputedStyle(document.getElementById(id));
  return {
    vh,
    wrap: r('inputBarWrap'),
    ta: r('inputBarText'),
    send: r('inputBarSend'),
    term: r('terminal-container'),
    taMaxH: cs('inputBarText').maxHeight,
    wrapAlign: cs('inputBarWrap').alignItems,
    barPos: cs('hotkeys-bar').position,
    barBottom: cs('hotkeys-bar').bottom,
    barAlign: cs('hotkeys-bar').alignItems,
    barBg: cs('hotkeys-bar').backgroundColor,
  };
});

const errors = [];
if (Math.abs(m.wrap.bottom - m.vh) > 2) errors.push(`输入条底边 ${m.wrap.bottom.toFixed(1)} 不在视口底 ${m.vh}（吸底失败）`);
if (Math.abs(m.ta.bottom - m.send.bottom) > 2) errors.push(`文本框底边 ${m.ta.bottom.toFixed(1)} 与换行按钮底边 ${m.send.bottom.toFixed(1)} 不平齐（flex-end 失败）`);
// 文本框与终端存在重叠 = 确实向上盖住终端（比单纯比较 top/bottom 更稳健）
const overlap = !(m.ta.bottom <= m.term.top || m.ta.top >= m.term.bottom);
if (!overlap) errors.push(`文本框(${m.ta.top.toFixed(1)}~${m.ta.bottom.toFixed(1)}) 未与终端(${m.term.top.toFixed(1)}~${m.term.bottom.toFixed(1)}) 重叠（未向上扩展盖住终端）`);
if (m.barPos !== 'sticky') errors.push(`hotkeys-bar position=${m.barPos}，应为 sticky`);
if (m.barBottom !== '0px') errors.push(`hotkeys-bar bottom=${m.barBottom}，应为 0px`);
if (m.barAlign !== 'flex-end') errors.push(`hotkeys-bar align-items=${m.barAlign}，应为 flex-end`);
if (m.wrapAlign !== 'flex-end') errors.push(`inputBarWrap align-items=${m.wrapAlign}，应为 flex-end`);
if (!m.taMaxH.includes('vh')) errors.push(`文本框 max-height=${m.taMaxH}，应为 ~50vh`);
if (m.barBg === 'rgba(0, 0, 0, 0)' || m.barBg === 'transparent') errors.push(`hotkeys-bar 背景透明，会透出终端文字`);

await page.screenshot({ path: 'tests/input-bar-upward.png' });
await browser.close();

if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: 输入条向上扩展、吸底、按钮平齐');
