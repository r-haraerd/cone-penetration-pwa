// Phase 3：測定の修正・削除・地点設定をスマホ画面で操作する
import { chromium, devices } from 'playwright';
const base = process.env.BASE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
const depths = () => page.$$eval('.record-row', (rs) => rs.map((r) => r.querySelector('.record-depth').textContent).reverse());
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(base);
await page.click('.app-footer >> text=＋ 新しい案件');
await page.fill('#project-number', '0540'); await page.fill('#project-name', '修正テスト');
await page.click('text=案件を作成'); await page.click('text=＋ K-1 を開始');
for (const [blow, mode] of [[5], [8], [12], [50, '5']]) {
  await page.fill('#blow-count', String(blow));
  if (mode) await page.click(`[data-mode="${mode}"]`);
  await page.click('.app-footer >> text=保存して次へ');
  await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
}
await page.click('.back-link'); await page.waitForSelector('.record-row');
check('初期深度', await depths(), ['0.10 m', '0.20 m', '0.30 m', '0.35 m']);

// No.2 を 10cm → 5cm に修正
await page.click('.record-row:has-text("No.2")');
await page.waitForSelector('#blow-count');
check('修正画面の初期値', [await page.inputValue('#blow-count'), await page.getAttribute('[data-mode="10"]', 'aria-pressed')], ['8', 'true']);
await page.click('[data-mode="5"]');
console.log('    予告表示:', (await page.textContent('.edit-preview')).trim());
await shot('20_edit');
await page.click('.app-footer >> text=修正を保存');
await page.waitForSelector('.point-hero');
check('No.2 を 5cm に修正後', await depths(), ['0.10 m', '0.15 m', '0.25 m', '0.30 m']);
check('現在深度', (await page.textContent('.point-hero .depth-value')).trim(), '0.30 m');

// No.2 を削除（確認ダイアログでキャンセル→実行）
await page.click('.record-row:has-text("No.2")');
await page.click('text=この測定記録を削除');
await shot('21_delete_confirm');
await page.click('.confirm-dialog >> text=キャンセル');
check('キャンセルでは消えない', await page.isVisible('text=修正を保存'), true);
await page.click('text=この測定記録を削除');
await page.click('.confirm-dialog >> text=削除する');
await page.waitForSelector('.point-hero');
check('No.2 削除後', await depths(), ['0.10 m', '0.20 m', '0.25 m']);
check('測定順の振り直し', await page.$$eval('.record-seq', (s) => s.map((x) => x.textContent).reverse()), ['No.1', 'No.2', 'No.3']);
await shot('22_point_after');

// 6 件以上 → 全記録一覧から No.1 を修正
await page.click('text=測定を続ける');
for (const b of [1, 2, 3]) {
  await page.fill('#blow-count', String(b));
  await page.click('.app-footer >> text=保存して次へ');
  await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
}
await page.click('.back-link');
await page.click('text=すべての記録を見る');
await page.waitForSelector('.record-row:has-text("No.1")'); await shot('23_records');
await page.click('.record-row:has-text("No.1")');
await page.fill('#blow-count', '6');
await page.click('[data-mode="other"]'); await page.fill('#other-cm', '7');
await page.click('.app-footer >> text=修正を保存');
await page.waitForSelector('.record-row:has-text("No.1")');
check('全記録一覧へ戻る', (await page.textContent('.app-title')).includes('すべての記録'), true);
check('No.1 を 7cm に修正後', await page.$$eval('.record-depth', (s) => s.map((x) => x.textContent)), ['0.07 m', '0.17 m', '0.22 m', '0.32 m', '0.42 m', '0.52 m']);

// 地点終了 → K-2 開始 → K-2 を K-3 に変更すると欠番警告 → 戻す → K-2 削除
await page.click('.back-link'); await page.click('text=地点終了'); await page.click('.confirm-dialog >> text=地点を終了');
await page.click('text=次の地点 K-2 を開始');
await page.fill('#blow-count', '4'); await page.click('.app-footer >> text=保存して次へ');
await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
await page.click('.back-link'); await page.click('text=地点番号の変更・地点の削除');
await page.fill('#point-number', '1'); await page.click('.renumber-btn');
check('使用中番号は拒否', (await page.textContent('.error-text')).trim(), 'K-1 は既に使われています');
await page.fill('#point-number', '3'); await page.click('.renumber-btn'); await page.click('.confirm-dialog >> text=番号を変更');
await page.waitForSelector('.point-hero'); check('番号変更', (await page.textContent('.point-hero-name')).startsWith('K-3'), true);
await page.click('.back-link'); await page.waitForSelector('.section-title');
check('欠番警告', (await page.textContent('.notice')).includes('K-2'), true);
await shot('24_gap');
await page.click('.point-card:has-text("K-3")'); await page.click('text=地点番号の変更・地点の削除');
await shot('25_settings');
await page.click('text=K-3 を削除'); await page.click('.confirm-dialog >> text=地点を削除');
await page.waitForSelector('.section-title');
check('地点削除後', await page.$$eval('.point-name', (s) => s.map((x) => x.textContent)), ['K-1']);
check('次は K-2', await page.isVisible('text=＋ K-2 を開始'), true);
// K-1（最後の番号でも測定あり）は削除可能、途中番号は不可 → 単体テストで確認済み
console.log('page errors:', errors);
await browser.close();
