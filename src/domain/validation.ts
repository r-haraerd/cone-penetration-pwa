// 入力値の検証。戻り値は { ok: true, value } または { ok: false, message }。

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const DIGITS_ONLY = /^[0-9]+$/;

/** 全角数字を半角にして前後の空白を除く（日本語入力のままでも受け付けるため） */
export function normalizeDigits(text: string): string {
  return text.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 打撃回数：0 以上の整数。上限は業務ルールが未定のため設けない */
export function parseBlowCount(text: string): Result<number> {
  const s = normalizeDigits(text);
  if (s === '') return { ok: false, message: '打撃回数を入力してください' };
  if (!DIGITS_ONLY.test(s)) return { ok: false, message: '打撃回数は 0 以上の整数で入力してください' };
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return { ok: false, message: '打撃回数が大きすぎます' };
  return { ok: true, value };
}

/** 貫入量：1 以上の整数 cm */
export function parsePenetrationCm(text: string): Result<number> {
  const s = normalizeDigits(text);
  if (s === '') return { ok: false, message: '貫入量（cm）を入力してください' };
  if (!DIGITS_ONLY.test(s)) return { ok: false, message: '貫入量は 1 以上の整数（cm）で入力してください' };
  const value = Number(s);
  if (value <= 0) return { ok: false, message: '貫入量は 1 cm 以上にしてください' };
  if (!Number.isSafeInteger(value)) return { ok: false, message: '貫入量が大きすぎます' };
  return { ok: true, value };
}

export function isValidBlowCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isValidPenetrationCm(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
