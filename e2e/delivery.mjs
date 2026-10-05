// 電子納品データ：学習用データ K-1 と同じ値を記録し、XML（ZIP）と柱状図 DXF を出力する
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('shots/downloads', { recursive: true });
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};
await page.goto(base);
await page.click('.app-footer >> text=＋ 新しい案件');
await page.fill('#project-number', '0999'); await page.fill('#project-name', 'サンプル地区'); await page.fill('#point-count', '2');
await page.click('text=案件を作成'); await page.click('.point-tile[data-point="K-1"]'); await page.click('.app-footer a.btn-primary');
for (const [b, pen] of [[5], [8], [2], [10], [50, 7]]) {
  await page.fill('#blow-count', String(b));
  if (pen) { await page.click('[data-mode="other"]'); await page.fill('#other-cm', String(pen)); }
  await page.click('.app-footer >> text=保存して次へ');
  await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
}
await page.click('.back-link'); await page.click('.back-link'); await page.click('.data-link');
await page.waitForSelector('.delivery-card');
await page.fill('#delivery-surveyTitle', '令和○年度［第○○号］サンプル地区急傾斜地崩壊対策に伴う地質調査業務委託');
await page.fill('#delivery-clientName', 'サンプル土木事務所');
await page.fill('#delivery-contractorName', 'サンプル地質株式会社');
await page.fill('#delivery-testerName', '試験者Ａ');
check('対象地点の表示', (await page.textContent('.delivery-card .hint:nth-of-type(2)')).includes('K-1（未測定の K-2 は含みません）'), true);
await page.screenshot({ path: 'shots/60_delivery.png', fullPage: true });
const save = async (sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  const path = `shots/downloads/${dl.suggestedFilename()}`; await dl.saveAs(path); return path;
};
const zip = await save('[data-export="xml"]');
const dxf = await save('[data-export="dxf"]');
console.log('ZIP', zip); console.log('DXF', dxf);
// 入力は案件に保存され、画面を開き直しても残る
await page.reload(); await page.waitForSelector('.delivery-card');
check('入力の保存', await page.inputValue('#delivery-testerName'), '試験者Ａ');
// Shift_JIS で表せない文字
await page.fill('#delivery-testerName', '𠮷田');
await page.click('[data-export="xml"]');
check('使えない文字の警告', (await page.textContent('.delivery-card .error-text')).includes('「𠮷」'), true);
console.log('page errors:', errors);
await browser.close();
