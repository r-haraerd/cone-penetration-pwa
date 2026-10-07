// 案件一覧から直接削除する（取り消し・バックアップの注意・削除後も一覧が使える）
import { chromium, devices } from 'playwright';
const base = process.env.BASE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};
const create = async (number, name) => {
  await page.goto(base);
  await page.click('.app-footer >> text=＋ 新しい案件');
  await page.fill('#project-number', number); await page.fill('#project-name', name); await page.fill('#point-count', '2');
  await page.click('text=案件を作成');
  await page.waitForSelector('.point-tile');
};
const titles = async () => { await page.waitForSelector('.app-main'); return page.$$eval('.project-card .card-title', (els) => els.map((e) => e.textContent.trim())); };

await create('0001', '残す案件');
await create('0002', '消す案件');
// 消す案件に 1 件記録しておく（バックアップの注意が出る）
await page.click('.point-tile[data-point="K-1"]'); await page.click('.app-footer a.btn-primary');
await page.fill('#blow-count', '3'); await page.click('.app-footer >> text=保存して次へ');
await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
await page.goto(base);
check('一覧に 2 件', (await titles()).length, 2);
await page.screenshot({ path: 'shots/80_list_delete.png', fullPage: true });

const deleteBtn = (name) => page.locator('.project-item', { hasText: name }).locator('.project-delete');
// 取り消し
await deleteBtn('消す案件').click();
await page.waitForSelector('.confirm-dialog');
check('確認の内容', (await page.textContent('.confirm-dialog')).includes('2 地点・1 測定'), true);
check('バックアップの注意', (await page.textContent('.confirm-dialog')).includes('バックアップ'), true);
await page.screenshot({ path: 'shots/81_list_delete_confirm.png' });
await page.click('.confirm-dialog button.btn-secondary');
check('取り消すと残る', (await titles()).length, 2);
// 削除
await deleteBtn('消す案件').click();
await page.click('.confirm-dialog button.btn-danger');
await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 1);
check('削除後の一覧', await titles(), ['0001 残す案件']);
// 記録のない案件ではバックアップの注意を出さない
await deleteBtn('残す案件').click();
check('記録なしなら注意なし', (await page.textContent('.confirm-dialog')).includes('バックアップ'), false);
await page.click('.confirm-dialog button.btn-secondary');
// カードを押すと今までどおり開く
await page.click('.project-card');
await page.waitForSelector('.point-tile');
check('カードで開く', (await page.textContent('.app-title')).trim(), '0001 残す案件');
console.log('page errors:', errors);
await browser.close();
