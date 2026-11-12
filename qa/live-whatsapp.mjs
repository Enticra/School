// Checks live WhatsApp end to end against a stand-in for Meta. Needs a server started with WHATSAPP_* settings
// pointing WHATSAPP_API_BASE at the stand-in. Usage: node qa/live-whatsapp.mjs http://localhost:8790 <shots dir>
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8790';
const out = process.argv[3] ?? 'qa/shots';
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); console.log(c ? '✓' : '✗', m); };
const rpc = async (token, method, args) => (await (await fetch(`${base}/api/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ args }) })).json()).result;
const login = async (phone) => { await fetch(`${base}/api/auth/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) }); return (await (await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, code: '123456' }) })).json()).token; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.setDefaultTimeout(8000);
await page.goto(base);
await page.getByRole('button', { name: /Mrs. S. Sujatha/ }).click();
await page.getByRole('button', { name: /Send code|Sign in|Continue/ }).first().click().catch(() => {});
await page.waitForSelector('.rail');
await page.locator('.rail nav button', { hasText: 'Parent messages' }).first().click();
await page.getByRole('button', { name: 'Link a phone' }).click();
await page.selectOption('#lw-p', { label: 'Mrs. P. Priya · parent of Arun Kumar P' }).catch(async () => { const v = await page.locator('#lw-p option').first().getAttribute('value'); await page.selectOption('#lw-p', v); });
await page.fill('#lw-r', '91 98765 43210');
check(await page.getByRole('button', { name: 'Link phone' }).isDisabled(), 'linking needs the owner’s agreement');
await page.locator('.modal input[type=checkbox]').check();
await page.getByRole('button', { name: 'Link phone' }).click();
await page.waitForTimeout(400);
check(await page.getByText('phone ending').count() > 0 && (await page.locator('main').textContent()).includes('3210') && !(await page.locator('main').textContent()).includes('9876543210'), 'linked phone shows only the last 4 digits');
await page.getByRole('button', { name: 'Send a test' }).first().click();
await page.waitForTimeout(400);

// A teacher marks Arun absent: his mother's message should go to the real phone.
const t = await login('9840033333');
const att = await rpc(t, 'getAttendance', ['cls_s1_10a', new Date().toISOString().slice(0, 10)]);
const marks = Object.fromEntries(att.students.map((s) => [s.id, 'P']));
marks.stu_cls_s1_10a_1 = 'A';
const r = await rpc(t, 'markAttendance', [{ classId: 'cls_s1_10a', date: new Date().toISOString().slice(0, 10), marks }]);
check(!!r, 'attendance saved');
await page.reload(); await page.waitForSelector('.rail');
await page.locator('.rail nav button', { hasText: 'Parent messages' }).first().click();
await page.waitForTimeout(800);
const liveRows = page.locator('tr', { has: page.locator('.pill.accent', { hasText: 'Live' }) });
check(await liveRows.count() >= 1, 'message for the linked parent is marked Live');
await page.screenshot({ path: `${out}/live-1-sent.png`, fullPage: false });

// Meta reports delivered, then read.
const p = await login('9840011111');
const wamid = (await rpc(p, 'listMessages', [{ limit: 50 }])).find((m) => m.live && m.providerId).providerId;
for (const status of ['delivered', 'read']) {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status }] } }] }] });
  const res = await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}` }, body });
  check(res.status === 200, `webhook accepts signed ${status}`);
}
await page.waitForTimeout(3500);
check((await liveRows.first().textContent()).includes('Read'), 'ticks turn to Read on their own');
await page.screenshot({ path: `${out}/live-2-read.png`, fullPage: false });
const bad = await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body: '{}' });
check(bad.status === 401, 'unsigned webhook calls are refused');
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${out}/live-3-mobile.png`, fullPage: false });
await browser.close();
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'All live WhatsApp checks passed.');
process.exit(fails.length ? 1 : 0);
