// Phase 5：圏外での起動・入力・再起動、新バージョンの知らせを確認する。
// GitHub Pages と同じくサブパス（/geo-tools/）で配信した dist を対象にする。
//   SITE_DIR=<配信ルート> BASE_URL=http://localhost:4180/geo-tools/ node e2e/offline.mjs
import { chromium, devices } from 'playwright';
import { execSync } from 'node:child_process';
const base = process.env.BASE_URL || 'http://localhost:4180/geo-tools/';
const siteDir = process.env.SITE_DIR; // 指定すると「新バージョン公開」も試す
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
const errors = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};
const open = async (url = base) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return page;
};

// 1. 初回はオンラインで開く → Service Worker が全ファイルを事前キャッシュ
let page = await open();
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // 2 回目から Service Worker の管理下になる
check('Service Worker 管理下', await page.evaluate(() => !!navigator.serviceWorker.controller), true);
const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
check('manifest', [manifest.short_name, manifest.display, manifest.icons.length], ['簡易貫入', 'standalone', 3]);
check('インストール案内（ブラウザ表示時）', await page.isVisible('.install-hint'), true);
await page.close();

// 2. 圏外にして新しく起動 → アプリが開き、案件作成・測定ができる
await ctx.setOffline(true);
page = await open();
await page.waitForSelector('text=＋ 新しい案件');
check('圏外で起動', await page.textContent('.net-badge'), '● オフライン');
await page.click('.app-footer >> text=＋ 新しい案件');
await page.fill('#project-number', '0540'); await page.fill('#project-name', '圏外テスト'); await page.fill('#point-count', '5');
await page.click('text=案件を作成'); await page.click('.point-tile[data-point="K-3"]'); await page.click('.app-footer >> text=測定を開始');
for (const b of [5, 8, 12]) {
  await page.fill('#blow-count', String(b));
  await page.click('.app-footer >> text=保存して次へ');
  await page.waitForFunction(() => document.querySelector('#blow-count').value === '');
}
const measureUrl = page.url();
await page.screenshot({ path: 'shots/40_offline_measure.png' });
await page.close();

// 3. 圏外のままアプリを閉じて開き直す（途中の画面の URL でも開ける）
page = await open(measureUrl);
await page.waitForSelector('.depth-value');
check('圏外で再起動しても深度が残る', (await page.textContent('.depth-value')).trim(), '0.30 m');
await page.goto(base);
await page.waitForSelector('.card-link');
check('圏外で案件一覧', (await page.textContent('.card-title')).trim(), '0540 圏外テスト');
await page.close();
await ctx.setOffline(false);

// 4. 新しいバージョンを公開 → 「新しいバージョンがあります」→ 更新してもデータは残る
if (siteDir) {
  execSync(`npx vite build && rm -rf ${siteDir}/geo-tools && cp -r dist ${siteDir}/geo-tools`, { stdio: 'ignore' });
  page = await open();
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector('.update-bar', { timeout: 20000 });
  check('新バージョンの知らせ', (await page.textContent('.update-bar span')).trim(), '新しいバージョンがあります');
  await page.screenshot({ path: 'shots/41_update_bar.png' });
  const scriptSrc = () => page.evaluate(() => document.querySelector('script[type=module]').src);
  const before = await scriptSrc();
  await Promise.all([page.waitForEvent('load'), page.click('.update-btn')]);
  await page.waitForSelector('.card-link');
  check('更新後に新しいビルドで動く', (await scriptSrc()) !== before, true);
  check('更新後もデータが残る', (await page.textContent('.card-meta')).trim(), '試験数量 5 地点 ・ 記録あり 1');
}
console.log('page errors:', errors);
await browser.close();
