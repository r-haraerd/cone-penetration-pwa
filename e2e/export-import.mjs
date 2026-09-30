// Phase 4：CSV 出力・JSON バックアップ・案件削除・復元をスマホ画面で操作する
import { chromium, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP', acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('shots/downloads', { recursive: true });
const shot = (n) => page.screenshot({ path: `shots/${n}.png` });
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};
const saveDownload = async (trigger) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = `shots/downloads/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), path, text: readFileSync(path, 'utf8') };
};
const measure = async (blow, mode) => {
  await page.fill('#blow-count', String(blow));
  if (mode) await page.click(`[data-mode="${mode}"]`);
  await page.click('.app-footer >> text=保存して次へ');
  await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
};

await page.goto(base);
await page.click('.app-footer >> text=＋ 新しい案件');
await page.fill('#project-number', '0540'); await page.fill('#project-name', '○○地区地質調査'); await page.fill('#point-count', '2');
await page.click('text=案件を作成'); await page.click('.point-tile[data-point="K-1"]'); await page.click('.app-footer >> text=測定を開始');
for (const [b, m] of [[5], [8], [12], [50, '5']]) await measure(b, m);
await page.click('.back-link'); await page.click('text=地点終了'); await page.click('.confirm-dialog >> text=地点を終了');
await page.click('text=地点一覧へ（次の地点を選ぶ）'); await page.click('.point-tile[data-point="K-2"]'); await page.click('.app-footer >> text=測定を開始'); await measure(7);
await page.click('.back-link'); await page.click('.back-link');
await page.waitForSelector('.data-link');
check('案件画面のバックアップ状態', (await page.textContent('.data-link .backup-status')).trim(), 'バックアップ：まだ保存していません');
await page.click('.data-link');
await page.waitForSelector('text=Excel 取込用 CSV');
await shot('30_data');

// CSV
const csv = await saveDownload(() => page.click('text=CSV を出力（5 件）'));
check('CSV ファイル名', /^0540_○○地区地質調査_簡易貫入_\d{8}-\d{4}\.csv$/.test(csv.name), true);
check('CSV BOM', csv.text.charCodeAt(0), 0xfeff);
const lines = csv.text.slice(1).trimEnd().split('\r\n');
check('CSV ヘッダー', lines[0], 'RecordID,PointID,ProjectNumber,PointName,PointNumber,Sequence,BlowCount,PenetrationCm,CumulativeDepthCm,RecordedAt');
check('CSV 本体（地点・順・回数・貫入・累積）', lines.slice(1).map((l) => l.split(',').slice(3, 9).join(',')),
  ['K-1,1,1,5,10,10', 'K-1,1,2,8,10,20', 'K-1,1,3,12,10,30', 'K-1,1,4,50,5,35', 'K-2,2,1,7,10,10']);
check('CSV 出力メッセージ', (await page.textContent('.result-text')).trim(), 'CSV を出力しました（5 件）');

// JSON バックアップ
const backup = await saveDownload(() => page.click('text=JSON バックアップを保存'));
const json = JSON.parse(backup.text);
check('JSON schemaVersion・地点', [json.schemaVersion, json.points.map((p) => p.pointName)], [1, ['K-1', 'K-2']]);
check('バックアップ状態が最新に', (await page.textContent('section .backup-status')).includes('（最新）'), true);
await shot('31_data_after');

// 案件削除 → 復元
await page.click('text=この案件を削除');
check('削除確認にバックアップ注意なし', (await page.textContent('.confirm-detail')).includes('最新のバックアップがありません'), false);
await shot('32_delete_confirm');
await page.click('.confirm-dialog >> text=案件を削除');
await page.waitForSelector('text=案件がありません');
await page.click('text=バックアップの取り込み（復元・受け取り・結合）');
await page.setInputFiles('#backup-file', backup.path);
await page.waitForSelector('text=この案件を復元'); await shot('33_import');
await page.click('text=この案件を復元');
await page.waitForSelector('.point-tile');
check('復元後の地点', await page.$$eval('.point-tile', (s) => s.map((x) => x.textContent)), ['K-10.35 m終了', 'K-20.10 m測定中']);

// 復元後に測定を追加 → 同じバックアップを再度読むと「既にある」→ 置き換え
await page.click('.point-tile[data-point="K-2"]'); await page.click('.app-footer >> text=測定を続ける'); await measure(9);
await page.goto(base + '#/import');
await page.setInputFiles('#backup-file', backup.path);
await page.waitForSelector('text=端末の案件を置き換える');
check('既存案件の警告', (await page.textContent('.import-result .notice')).includes('端末のデータの方が新しいです'), true);
await shot('34_import_exists');
await page.click('text=端末の案件を置き換える'); await page.click('.confirm-dialog >> text=置き換える');
await page.waitForSelector('.point-tile');
check('置き換え後（K-2 は 0.10 m に戻る）', await page.$$eval('.point-tile', (s) => s.map((x) => x.textContent)), ['K-10.35 m終了', 'K-20.10 m測定中']);

// 壊れたファイル
writeFileSync('shots/downloads/broken.json', backup.text.slice(0, 200));
const tampered = JSON.parse(backup.text); tampered.points[0].measurements[2].cumulativeDepthCm = 99;
writeFileSync('shots/downloads/tampered.json', JSON.stringify(tampered));
await page.goto(base + '#/import');
await page.setInputFiles('#backup-file', 'shots/downloads/broken.json');
await page.waitForSelector('.error-list');
check('壊れた JSON', (await page.textContent('.error-list')).includes('JSON として読み込めません'), true);
await page.setInputFiles('#backup-file', 'shots/downloads/tampered.json');
await page.waitForFunction(() => document.querySelector('.error-list')?.textContent.includes('累積深度'));
await shot('35_import_error');
await page.goto(base);
await page.waitForSelector('.card-link');
check('壊れたファイル後も案件は無事', (await page.textContent('.card-meta')).trim(), '試験数量 2 地点 ・ 記録あり 2');
console.log('page errors:', errors);
await browser.close();
