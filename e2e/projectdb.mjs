// 業務DB連携：業務番号から調査件名・発注機関を自動入力する（API は Playwright で差し替え）
// ビルド時に VITE_PROJECT_API_BASE=https://api.example.test VITE_DEFAULT_CONTRACTOR=サンプル地質株式会社 を指定しておくこと
import { chromium, devices } from 'playwright';
const base = process.env.BASE_URL || 'http://localhost:4173/';
const API = 'https://api.example.test';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' expected ' + JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
};

const records = {
  '01234': { project_id: '01234', project_name: '令和○年度 サンプル地区地質調査業務委託', client_name: 'サンプル土木事務所', company_name: 'X' },
  '05555': { project_id: '05555', project_name: 'サンプル地区擁壁工事に伴う地質調査業務', client_name: '有限会社　サンプル組', company_name: 'X' },
};
const seenKeys = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'x-api-key, authorization', 'access-control-allow-methods': 'GET, OPTIONS' };
await ctx.route(`${API}/**`, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const key = req.headers()['x-api-key'];
  seenKeys.push(key);
  const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (key !== 'good-key') return json(401, { error: 'unauthorized' });
  const url = new URL(req.url());
  if (url.pathname === '/api/projects') return json(200, { items: [] });
  const rec = records[decodeURIComponent(url.pathname.split('/').pop())];
  return rec ? json(200, rec) : json(404, { error: 'not found' });
});

const newProject = async (number, name) => {
  await page.goto(base);
  await page.click('.app-footer >> text=＋ 新しい案件');
  await page.fill('#project-number', number);
  await page.click('#project-name'); // 業務番号欄を離れると取得する
  await page.waitForFunction(() => document.querySelector('#db-result').textContent || document.querySelector('#db-status').textContent);
  await page.waitForFunction(() => !document.querySelector('#db-status').textContent.includes('確認しています'));
};
const openData = async () => {
  await page.click('.data-link');
  await page.waitForSelector('.delivery-card');
};
const fields = async () => Promise.all(['surveyTitle', 'clientName', 'contractorName', 'testerName'].map((k) => page.inputValue(`#delivery-${k}`)));

// 1. キー未設定
await newProject('01234');
check('キー未設定の案内', (await page.textContent('#db-status')).includes('キーが未設定'), true);

// 2. 設定画面：間違ったキー → 401 の案内、正しいキー → 接続できた
await page.goto(base);
await page.click('.app-footer >> text=業務DB連携の設定');
await page.fill('#api-key', 'bad-key');
await page.click('[data-action="save-test"]');
await page.waitForFunction(() => document.querySelector('.error-text').textContent);
check('間違ったキー', (await page.textContent('.error-text')).includes('API キーが正しくありません'), true);
await page.fill('#api-key', 'good-key');
await page.click('[data-action="save-test"]');
await page.waitForFunction(() => document.querySelector('.result-text').textContent.includes('接続できました'));
check('正しいキーで接続', true, true);
await page.screenshot({ path: 'shots/70_db_settings.png', fullPage: true });

// 3. 業務番号を入れると取得 → 案件作成で電子納品データに入る
await newProject('０１２３４'); // 全角でも可
check('調査件名の欄に自動で入る', await page.inputValue('#project-name'), '令和○年度 サンプル地区地質調査業務委託');
check('発注機関の表示', (await page.textContent('#db-result')).includes('サンプル土木事務所'), true);
await page.screenshot({ path: 'shots/71_db_new_project.png', fullPage: true });
await page.fill('#point-count', '2');
await page.click('text=案件を作成');
await page.waitForSelector('.point-tile');
check('見出しは調査件名', (await page.textContent('.app-title')).trim(), '01234 令和○年度 サンプル地区地質調査業務委託');
await openData();
check('自動入力（作成時）', await fields(), ['令和○年度 サンプル地区地質調査業務委託', 'サンプル土木事務所', 'サンプル地質株式会社', '']);

// 3b. 入力が止まれば欄を離れなくても取得する。業務番号を変えると自動で入れた件名は入れ替わる
await page.goto(base);
await page.click('.app-footer >> text=＋ 新しい案件');
await page.fill('#project-number', '01234');
await page.waitForFunction(() => document.querySelector('#project-name').value !== '');
await page.fill('#project-number', '05555');
await page.waitForFunction(() => document.querySelector('#project-name').value.includes('擁壁'));
check('業務番号の変更で入れ替わる', await page.inputValue('#project-name'), 'サンプル地区擁壁工事に伴う地質調査業務');
// 手で書き換えた件名は上書きしない
await page.fill('#project-name', '手で書いた件名');
await page.fill('#project-number', '01234');
await page.waitForFunction(() => document.querySelector('#db-result').textContent.includes('01234'));
check('手入力の件名は残す', await page.inputValue('#project-name'), '手で書いた件名');
check('API キーをヘッダーで送る', seenKeys.includes('good-key'), true);

// 4. 登録のない業務番号 → 案内のみ。調査業者名は既定値
await newProject('99999');
check('未登録の案内', (await page.textContent('#db-status')).includes('登録されていません'), true);
await page.fill('#project-name', '手入力の調査件名'); await page.fill('#point-count', '1');
await page.click('text=案件を作成');
await openData();
check('手入力の調査件名と既定の調査業者名', await fields(), ['手入力の調査件名', '', 'サンプル地質株式会社', '']);

// 5. 下請案件：データ出力画面のボタンで取得 → 元請名の注意
await page.goto(base);
await page.click('.app-footer >> text=＋ 新しい案件');
await page.fill('#project-number', '05555'); await page.fill('#project-name', '下請'); await page.fill('#point-count', '1');
await page.click('text=案件を作成');
await openData();
await page.fill('#delivery-surveyTitle', '手入力の件名');
await page.click('[data-action="fetch-db"]');
await page.waitForFunction(() => document.querySelector('#delivery-db-result').textContent);
check('ボタンで取得（上書き）', await fields(), ['サンプル地区擁壁工事に伴う地質調査業務', '有限会社　サンプル組', 'サンプル地質株式会社', '']);
check('元請名の注意', (await page.textContent('#delivery-db-result')).includes('下請案件では元請の会社名'), true);
await page.screenshot({ path: 'shots/72_db_delivery.png', fullPage: true });
await page.fill('#delivery-clientName', 'サンプル県土木事務所'); // 確認して直す
await page.reload(); await page.waitForSelector('.delivery-card');
check('取得後の値は保存される', (await fields())[0], 'サンプル地区擁壁工事に伴う地質調査業務');

console.log('page errors:', errors);
await browser.close();
