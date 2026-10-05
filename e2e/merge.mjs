// 分担記録の結合：代表者 A と メンバー B の 2 台（別々のブラウザ環境）で操作する
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
mkdirSync('shots/downloads', { recursive: true });
const errors = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};
async function device(name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  return page;
}
async function createProject(page, number, name, count) {
  await page.goto(base);
  await page.click('.app-footer >> text=＋ 新しい案件');
  await page.fill('#project-number', number); await page.fill('#project-name', name); await page.fill('#point-count', String(count));
  await page.click('text=案件を作成'); await page.waitForSelector('.point-tile');
}
async function recordAt(page, point, blows) {
  await page.click(`.point-tile[data-point="${point}"]`);
  await page.click('.app-footer a.btn-primary'); // 測定を開始 / 測定を続ける
  for (const b of blows) {
    await page.fill('#blow-count', String(b));
    await page.click('.app-footer >> text=保存して次へ');
    await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
  }
  await page.click('.back-link'); await page.click('.back-link'); await page.waitForSelector('.point-tile');
}
async function backup(page, file) {
  await page.click('.data-link'); await page.waitForSelector('text=JSON バックアップを保存');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=JSON バックアップを保存')]);
  const path = `shots/downloads/${file}`; await dl.saveAs(path);
  await page.click('.back-link'); await page.waitForSelector('.point-tile');
  return path;
}
async function importFile(page, path) {
  await page.goto(base + '#/import');
  await page.setInputFiles('#backup-file', path);
  await page.waitForSelector('.import-result .card');
}
const tiles = (page) => page.$$eval('.point-tile', (s) => s.map((x) => `${x.querySelector('.tile-name').textContent}:${x.querySelector('.tile-depth').textContent}`));

const A = await device('A');
const B = await device('B');

// 1. 出発前：A が案件を作って配る → B が受け取る
await createProject(A, '0540', '○○地区地質調査', 4);
const dist = await backup(A, 'distribute.json');
await importFile(B, dist);
await B.click('text=この案件を復元'); await B.waitForSelector('.point-tile');
check('B が受け取った案件', await tiles(B), ['K-1:―', 'K-2:―', 'K-3:―', 'K-4:―']);

// 2. 現場：A は K-1・K-2、B は K-3・K-4 と K-1（競合）を記録
await recordAt(A, 'K-1', [5, 8]);
await recordAt(A, 'K-2', [3]);
await recordAt(B, 'K-3', [7, 9, 11]);
await recordAt(B, 'K-4', [2]);
await recordAt(B, 'K-1', [20]);

// 3. 帰社後：B のファイルを A で結合
const fromB = await backup(B, 'member-b.json');
await importFile(A, fromB);
check('既存案件には結合がおすすめ表示', await A.isVisible('text=結合して取り込む（おすすめ）'), true);
await A.click('text=結合して取り込む（おすすめ）');
await A.waitForSelector('.merge-review');
check('結合の要約', (await A.textContent('.merge-summary')).replace(/\s+/g, ''), 'ファイルから取り込む：K-3、K-4選択が必要：K-1');
check('競合があるうちは結合できない', await A.isDisabled('[data-merge]'), true);
await A.screenshot({ path: 'shots/50_merge_review.png', fullPage: true });
await A.click('.conflict-card[data-point="K-1"] [data-side="local"]');
check('選ぶと結合できる', await A.isDisabled('[data-merge]'), false);
await A.click('[data-merge]');
await A.waitForSelector('.point-tile');
check('結合後（K-1 は A の記録を残す）', await tiles(A), ['K-1:0.20 m', 'K-2:0.10 m', 'K-3:0.30 m', 'K-4:0.10 m']);
await A.screenshot({ path: 'shots/51_merged.png' });

// 4. 同じファイルを再度結合しても変わらない
await importFile(A, fromB);
await A.click('text=結合して取り込む（おすすめ）'); await A.waitForSelector('.merge-review');
check('再結合では取り込みなし（K-1 は選択のみ）', (await A.textContent('.merge-summary')).replace(/\s+/g, ''), 'ファイルから取り込む：なし選択が必要：K-1');

// 5. 別々に作った同じ業務番号の案件 → 確認のうえ K 番号で結合
await createProject(A, '0777', 'A作成', 2);
await recordAt(A, 'K-1', [4]);
await createProject(B, '0777', 'B作成', 2);
await recordAt(B, 'K-2', [6, 6]);
const separate = await backup(B, 'separate-b.json');
await importFile(A, separate);
check('業務番号一致の確認', (await A.textContent('.import-result .notice')).includes('同じ業務番号「0777」'), true);
await A.screenshot({ path: 'shots/52_same_number.png' });
await A.click('text=「0777 A作成」と結合する');
await A.waitForSelector('.merge-review');
await A.click('[data-merge]');
await A.waitForSelector('.point-tile');
check('K 番号で結合', await tiles(A), ['K-1:0.10 m', 'K-2:0.20 m']);
check('案件は増えていない', await (async () => { await A.goto(base); await A.waitForSelector('.card-link'); return (await A.$$('.card-link')).length; })(), 2);

console.log('page errors:', errors);
await browser.close();
