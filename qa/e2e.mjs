// End-to-end QA on the single-file demo build: signs in as each sample user,
// walks the main flows, checks for console errors and horizontal overflow,
// and saves screenshots. Run: npm run build:demo && npm run e2e
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = 'file://' + resolve('apps/web/dist-demo/index.html');
const out = resolve(process.env.SHOTS ?? 'qa/shots');
mkdirSync(out, { recursive: true });
const errors = [];
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const browser = await chromium.launch();

async function session(name, { width = 1360, height = 900, theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(url);
  return { ctx, page };
}

async function overflow(page, label) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(w <= 1, `${label}: page scrolls sideways by ${w}px`);
}

async function signIn(page, who) {
  await page.getByRole('button', { name: new RegExp(who) }).click();
  await page.waitForSelector('.rail');
}

async function nav(page, label) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.locator('.rail').getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(250);
}

const shot = (page, n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: false });

// ---------- Login
{
  const { ctx, page } = await session('login');
  await shot(page, '01-login');
  await overflow(page, 'login');
  // Phone + OTP flow
  await page.fill('#phone', '9840022222');
  await page.getByRole('button', { name: /Send code/ }).click();
  await page.fill('#code', '000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('[role=alert]');
  check((await page.textContent('[role=alert]')).includes('wrong'), 'wrong OTP shows an error');
  await page.fill('#code', '123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.rail');
  check(await page.isVisible('text=Mr. K. Karthik'), 'teacher signed in with OTP');
  await ctx.close();
}

// ---------- Teacher: AI correction flow
{
  const { ctx, page } = await session('teacher');
  await signIn(page, 'Mr. K. Karthik');
  await shot(page, '02-teacher-today');
  await nav(page, 'AI correction');
  await page.getByText('Maths · Revision Test 1').click();
  await page.getByRole('button', { name: /Correct \d+ scripts with AI/ }).click();
  await page.waitForSelector('text=Start review', { timeout: 20000 });
  await shot(page, '03-correction-list');
  await page.getByRole('button', { name: 'Start review' }).click();
  await page.waitForSelector('.script');
  await page.waitForTimeout(300);
  await shot(page, '04-correction-review');
  // Override one mark and approve
  await page.locator('.mark-input').first().fill('1');
  await page.getByRole('button', { name: /Approve and next/ }).click();
  await page.waitForTimeout(400);
  check(await page.isVisible('.script'), 'review moves to the next script');
  await page.getByRole('button', { name: 'Close' }).click();
  check(await page.isVisible('text=Approved'), 'approved script shows in the list');
  await overflow(page, 'correction');
  // Homework
  await nav(page, 'Homework');
  await page.fill('#hw-title', 'Exercise 8.1, sums 1 to 4');
  await page.getByRole('button', { name: /Post and notify/ }).click();
  await page.waitForSelector('text=parents notified');
  await shot(page, '05-homework');
  // Tests and marks
  await nav(page, 'Tests and marks');
  await shot(page, '06-tests');
  await page.getByRole('button', { name: 'New test' }).click();
  await page.fill('#nt-name', 'Unit Test 3');
  await page.fill('#q0-text', 'Find the mean of 2, 4, 6');
  await page.fill('#q0-ch', 'Statistics and Probability');
  await page.locator('input[aria-label=Step]').first().fill('Mean = 4');
  await page.getByRole('button', { name: 'Create test' }).click();
  await page.waitForSelector('text=Marks by question');
  await page.locator('.mark-input').first().fill('2');
  await page.getByRole('button', { name: /Save 1 changes/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Publish to parents/ }).click();
  await page.locator('.modal').getByRole('button', { name: 'Publish and notify parents' }).click();
  await page.waitForSelector('text=Published.');
  await shot(page, '07-test-detail');
  await ctx.close();
}

// ---------- Class advisor: attendance
{
  const { ctx, page } = await session('attendance');
  await signIn(page, 'Mrs. R. Lakshmi');
  await nav(page, 'Attendance');
  await page.waitForSelector('.reg-cell');
  const cells = page.locator('.reg-cell');
  await cells.nth(1).click();
  await cells.nth(2).click();
  await cells.nth(2).click();
  check((await cells.nth(1).getAttribute('data-m')) === 'A', 'tap marks absent');
  check((await cells.nth(2).getAttribute('data-m')) === 'L', 'two taps mark late');
  await page.getByRole('button', { name: /Save and notify parents|Update and notify/ }).click();
  await page.waitForSelector('.wa .bubble');
  await shot(page, '08-attendance');
  await ctx.close();
}

// ---------- Principal: dashboard, students, reports, settings, messages
{
  const { ctx, page } = await session('principal');
  await signIn(page, 'Mrs. S. Sujatha');
  await page.waitForSelector('text=Needs attention');
  await shot(page, '09-principal-today');
  await overflow(page, 'principal today');
  await nav(page, 'Students');
  await page.getByText('Arun Kumar P').first().click();
  await page.waitForSelector('text=Activities and achievements');
  await shot(page, '10-student-profile');
  await nav(page, 'Report cards');
  await page.waitForSelector('.report');
  await shot(page, '11-report-card');
  await nav(page, 'Parent messages');
  await shot(page, '12-messages');
  await nav(page, 'Settings and branding');
  await page.fill('#s-short', 'Sri Vidya');
  await page.locator('#s-primary').fill('#14532d');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForSelector('text=Settings version 2');
  const rail = await page.locator('.rail').evaluate((el) => getComputedStyle(el).backgroundColor);
  check(rail === 'rgb(20, 83, 45)', `rail picks up the new school colour (got ${rail})`);
  await shot(page, '13-settings');
  await ctx.close();
}

// ---------- Parent, Tamil-first school, admin
{
  const { ctx, page } = await session('parent');
  await signIn(page, 'Mrs. P. Priya');
  await page.waitForSelector('text=Homework due');
  await shot(page, '14-parent-today');
  await page.getByRole('button', { name: 'Report card' }).click();
  await page.waitForSelector('.report');
  await shot(page, '15-parent-report');
  check(!(await page.isVisible('text=Settings and branding')), 'parent has no settings');
  await ctx.close();
}
{
  const { ctx, page } = await session('school2');
  await signIn(page, 'Mrs. Mary Selvi');
  await page.waitForSelector('text=Needs attention');
  check(!(await page.locator('.rail').getByText('AI correction').isVisible()), 'AI correction hidden when module is off');
  await shot(page, '16-second-school');
  await ctx.close();
}
{
  const { ctx, page } = await session('admin');
  await signIn(page, 'Enticra Support');
  await page.getByRole('button', { name: 'Add a school' }).click();
  await page.fill('#a-name', 'Green Valley Matriculation School');
  await page.fill('#a-pn', 'Mr. Anand');
  await page.fill('#a-pp', '9876543210');
  await page.getByRole('button', { name: 'Create school' }).click();
  await page.waitForSelector('text=is set up with default settings');
  await page.getByRole('button', { name: 'Done' }).click();
  await shot(page, '17-admin');
  await ctx.close();
}

// ---------- Phone width and dark theme
for (const [name, who, theme] of [['18-phone-teacher', 'Mr. K. Karthik', 'light'], ['19-phone-parent-dark', 'Mrs. P. Priya', 'dark']]) {
  const { ctx, page } = await session(name, { width: 390, height: 844, theme });
  await page.evaluate(() => localStorage.removeItem('ent-theme'));
  await overflow(page, `${name} login`);
  await signIn(page, who);
  await page.waitForTimeout(400);
  await overflow(page, name);
  await shot(page, name);
  if (who.includes('Karthik')) {
    await nav(page, 'AI correction');
    await page.getByText('Maths · Revision Test 1').click();
    await page.waitForTimeout(300);
    await overflow(page, 'phone correction');
    await shot(page, '20-phone-correction');
  }
  await ctx.close();
}
{
  const { ctx, page } = await session('dark-principal', { theme: 'dark' });
  await signIn(page, 'Mrs. S. Sujatha');
  await page.waitForSelector('text=Needs attention');
  await shot(page, '21-dark-principal');
  await ctx.close();
}

await browser.close();
console.log(`Screenshots in ${out}`);
if (errors.length) console.log('Console errors:\n' + errors.join('\n'));
if (failures.length) { console.log('FAILED:\n' + failures.join('\n')); process.exit(1); }
console.log('All checks passed.');
