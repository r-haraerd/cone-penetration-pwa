/**
 * Shift_JIS（Windows-31J / CP932）への変換。
 * ブラウザの TextEncoder は UTF-8 しか出力できないため、TextDecoder('shift_jis') で
 * 全コードを一度デコードして逆引き表を作る（ライブラリ不要。初回だけ数 ms）。
 * 電子納品の XML（encoding="Shift_JIS"）と DXF（$DWGCODEPAGE ANSI_932）で使う。
 */

let table: Map<string, number> | null = null;

function buildTable(): Map<string, number> {
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const map = new Map<string, number>();
  const pair = new Uint8Array(2);
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      let ch: string;
      try {
        ch = decoder.decode(pair);
      } catch {
        continue;
      }
      // 同じ文字に複数のコードがある場合（NEC 選定 IBM 拡張など）は最初のコードを使う
      if (ch.length === 1 && !map.has(ch)) map.set(ch, (lead << 8) | trail);
    }
  }
  // 半角カナ
  for (let b = 0xa1; b <= 0xdf; b++) {
    const ch = decoder.decode(new Uint8Array([b]));
    if (!map.has(ch)) map.set(ch, b);
  }
  return map;
}

export class ShiftJisError extends Error {
  constructor(readonly char: string) {
    super(`「${char}」は Shift_JIS で表せない文字です。別の文字に置き換えてください`);
  }
}

/** 文字列を Shift_JIS のバイト列にする。表せない文字があれば ShiftJisError */
export function encodeShiftJis(text: string): Uint8Array<ArrayBuffer> {
  if (!table) table = buildTable();
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    // 円記号・オーバーラインは Shift_JIS の 0x5C / 0x7E に寄せる
    if (ch === '¥') { out.push(0x5c); continue; }
    if (ch === '‾') { out.push(0x7e); continue; }
    const sj = table.get(ch);
    if (sj === undefined) throw new ShiftJisError(ch);
    if (sj > 0xff) out.push(sj >> 8, sj & 0xff);
    else out.push(sj);
  }
  return new Uint8Array(out);
}

/** Shift_JIS で表せない最初の文字（なければ null） */
export function findNonShiftJis(text: string): string | null {
  try {
    encodeShiftJis(text);
    return null;
  } catch (e) {
    return e instanceof ShiftJisError ? e.char : null;
  }
}
