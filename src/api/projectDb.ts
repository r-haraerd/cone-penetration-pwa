import { appConfig } from '../config';
import { normalizeDigits } from '../domain/validation';

/**
 * 社内の業務データベース参照 API（読み取り専用）。
 *
 * - GET {base}/api/projects/{業務番号}   … 業務詳細（業務番号は完全一致・文字列のまま扱う）
 * - GET {base}/api/projects?q=..&limit=1 … 業務検索（接続テストに使う）
 * - 認証は x-api-key ヘッダー。キーは端末ごとに入力し、その端末の中だけに保存する
 *
 * 電子納品の標題情報との対応
 * - 調査件名     ← project_name（業務名）
 * - 発注機関名称 ← client_name。社内 DB では「元請または発注者」なので、下請案件では元請の会社名が入る。
 *                 そのため自動入力後も必ず確認・修正できるようにしておく
 * - 調査業者名   ← DB には使わず、既定値（appConfig.defaultContractorName）を入れる
 *
 * API が止まっていても、手入力でそのまま使える（取得は補助）。
 */

const KEY_STORAGE = 'cone-pwa.projectDbApiKey';
const TIMEOUT_MS = 10_000;

export type ProjectDbErrorKind = 'not-configured' | 'no-key' | 'unauthorized' | 'not-found' | 'offline' | 'server' | 'bad-response';

export class ProjectDbError extends Error {
  constructor(public readonly kind: ProjectDbErrorKind, message: string) {
    super(message);
    this.name = 'ProjectDbError';
  }
}

export interface ProjectDbRecord {
  projectNumber: string;
  /** 調査件名に入れる値（業務名） */
  surveyTitle: string;
  /** 発注機関名称に入れる値（元請の場合あり） */
  clientName: string;
  /** client_name が会社名に見える（下請案件の可能性が高い） */
  clientLooksLikeCompany: boolean;
}

/** API が使える状態か（ビルド時に URL が設定されているか） */
export function projectDbAvailable(): boolean {
  return appConfig.projectApiBase !== '';
}

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  const value = key.trim();
  try {
    if (value) localStorage.setItem(KEY_STORAGE, value);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    throw new ProjectDbError('no-key', 'この端末にキーを保存できませんでした（プライベートブラウズ等では保存できません）');
  }
}

/** 下請案件の目安：client_name が会社名の形をしている */
export function looksLikeCompany(name: string): boolean {
  return /株式会社|有限会社|合同会社|合資会社|合名会社|（株）|\(株\)|（有）|\(有\)|建設|工業|組$/.test(name);
}

interface Options {
  base?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

async function request(path: string, opts: Options): Promise<unknown> {
  const base = opts.base ?? appConfig.projectApiBase;
  const apiKey = opts.apiKey ?? getApiKey();
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  if (!base) throw new ProjectDbError('not-configured', '業務DB連携は設定されていません');
  if (!apiKey) throw new ProjectDbError('no-key', '業務DBの API キーが未設定です（案件一覧 →「業務DB連携の設定」）');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ProjectDbError('offline', 'オフラインのため業務DBに接続できません。電波のある所で取得してください');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(`${base}${path}`, { headers: { 'x-api-key': apiKey }, signal: controller.signal, cache: 'no-store' });
  } catch {
    throw new ProjectDbError('offline', '業務DBに接続できませんでした。電波状況を確認して、もう一度お試しください');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new ProjectDbError('unauthorized', '業務DBの API キーが正しくありません（案件一覧 →「業務DB連携の設定」で確認）');
  if (res.status === 404) throw new ProjectDbError('not-found', 'この業務番号は業務DBに登録されていません');
  if (!res.ok) throw new ProjectDbError('server', `業務DBでエラーが起きました（${res.status}）。少し待ってから、もう一度お試しください`);
  try {
    return await res.json();
  } catch {
    throw new ProjectDbError('bad-response', '業務DBの応答を読み取れませんでした');
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 業務番号で業務を 1 件取得する */
export async function fetchProjectRecord(projectNumber: string, opts: Options = {}): Promise<ProjectDbRecord> {
  const number = normalizeDigits(projectNumber).trim();
  if (!number) throw new ProjectDbError('not-found', '業務番号を入力してください');
  const body = await request(`/api/projects/${encodeURIComponent(number)}`, opts);
  if (!body || typeof body !== 'object' || !str((body as Record<string, unknown>).project_id)) {
    throw new ProjectDbError('bad-response', '業務DBの応答を読み取れませんでした');
  }
  const rec = body as Record<string, unknown>;
  const clientName = str(rec.client_name);
  return {
    projectNumber: str(rec.project_id),
    surveyTitle: str(rec.project_name),
    clientName,
    clientLooksLikeCompany: looksLikeCompany(clientName),
  };
}

/** キーと接続の確認（検索 API を 1 件だけ呼ぶ） */
export async function testConnection(opts: Options = {}): Promise<void> {
  const body = await request('/api/projects?q=00&limit=1', opts);
  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).items)) {
    throw new ProjectDbError('bad-response', '業務DBの応答を読み取れませんでした');
  }
}
