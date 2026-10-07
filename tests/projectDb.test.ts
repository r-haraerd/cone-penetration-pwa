import { describe, expect, it } from 'vitest';
import { fetchProjectRecord, looksLikeCompany, ProjectDbError, testConnection } from '../src/api/projectDb';

const BASE = 'https://api.example.test';
/** 呼ばれた URL・ヘッダーを記録し、決めた応答を返す fetch */
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; key: string | null }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get('x-api-key') });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const opts = (fetchFn: typeof fetch) => ({ base: BASE, apiKey: 'k1', fetchFn });

// 仕様書の例と同じ形の応答（値は架空）
const detail = {
  project_id: '01234', project_name: '令和○年度 サンプル地区地質調査業務委託', site_address: 'サンプル市',
  client_name: 'サンプル土木事務所', client_tecris_code: null, company_name: 'サンプル地質株式会社', company_tel: '000-000-0000',
  chief_engineer_name: null, chief_engineer_license: '06867', start_date: null, end_date: null, updated_at: '2026-06-05T03:37:42+00:00',
};

describe('業務DB参照 API', () => {
  it('業務番号で取得し、調査件名＝業務名・発注機関名称＝client_name に対応させる', async () => {
    const { fn, calls } = fakeFetch(200, detail);
    const rec = await fetchProjectRecord(' ０１２３４ ', opts(fn));
    expect(calls).toEqual([{ url: `${BASE}/api/projects/01234`, key: 'k1' }]);
    // 業務番号は文字列のまま（先頭ゼロを保つ）。調査業者名は DB の値を使わない
    expect(rec).toEqual({ projectNumber: '01234', surveyTitle: detail.project_name, clientName: 'サンプル土木事務所', clientLooksLikeCompany: false });
  });

  it('下請案件（client_name が元請の会社名）を見分ける', async () => {
    const { fn } = fakeFetch(200, { ...detail, client_name: '有限会社　サンプル組' });
    expect((await fetchProjectRecord('01234', opts(fn))).clientLooksLikeCompany).toBe(true);
    expect([looksLikeCompany('サンプル建設株式会社'), looksLikeCompany('（株）サンプル'), looksLikeCompany('サンプル土木事務所'), looksLikeCompany('サンプル市役所')])
      .toEqual([true, true, false, false]);
  });

  it('client_name が null なら空欄にする', async () => {
    const { fn } = fakeFetch(200, { ...detail, client_name: null });
    expect((await fetchProjectRecord('01234', opts(fn))).clientName).toBe('');
  });

  it.each([
    [401, 'unauthorized'], [404, 'not-found'], [502, 'server'], [500, 'server'],
  ] as const)('HTTP %i は %s として分かる言葉で返す', async (status, kind) => {
    const { fn } = fakeFetch(status, { error: 'x' });
    const err = await fetchProjectRecord('01234', opts(fn)).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectDbError);
    expect(err.kind).toBe(kind);
  });

  it('通信できないときは offline', async () => {
    const fn = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchProjectRecord('01234', opts(fn))).rejects.toMatchObject({ kind: 'offline' });
  });

  it('URL 未設定・キー未設定なら API を呼ばない', async () => {
    const { fn, calls } = fakeFetch(200, detail);
    await expect(fetchProjectRecord('01234', { base: '', apiKey: 'k1', fetchFn: fn })).rejects.toMatchObject({ kind: 'not-configured' });
    await expect(fetchProjectRecord('01234', { base: BASE, apiKey: '', fetchFn: fn })).rejects.toMatchObject({ kind: 'no-key' });
    expect(calls).toHaveLength(0);
  });

  it('業務番号は URL エンコードする', async () => {
    const { fn, calls } = fakeFetch(200, detail);
    await fetchProjectRecord('A/1 2', opts(fn));
    expect(calls[0].url).toBe(`${BASE}/api/projects/A%2F1%202`);
  });

  it('接続テストは検索 API を 1 件だけ呼ぶ', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    await testConnection(opts(fn));
    expect(calls[0].url).toBe(`${BASE}/api/projects?q=00&limit=1`);
  });
});
