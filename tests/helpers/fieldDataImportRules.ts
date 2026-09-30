/**
 * geo-tools/FieldDataImport.bas（Excel 取込マクロ）の CSV 解析と検証を TypeScript に移植したもの。
 * PWA が出力する CSV がマクロに受け付けられることを、Excel なしでテストするために使う。
 * マクロを変更したときはこのファイルも合わせて更新すること。
 */

export interface ImportResult {
  ok: boolean;
  problems: string[];
  maxPoint: number;
  totalCount: number;
  /** [地点番号] => [[打撃回数, 累積深度], ...]（Excel の B/C 列に書かれる値） */
  sheets: Map<number, Array<[number, number]>>;
}

/** ParseCsv の移植 */
export function vbaParseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i < content.length - 1 && content[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      if (current.length !== 0) throw new Error('CSV の引用符位置が不正です。');
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else if (ch === '\r' || ch === '\n') {
      fields.push(current);
      rows.push(fields);
      fields = [];
      current = '';
      if (ch === '\r' && content[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (inQuotes) throw new Error('CSV の引用符が閉じていません。');
  if (current.length > 0 || fields.length > 0) {
    fields.push(current);
    rows.push(fields);
  }
  return rows;
}

/** ParseUnsigned の移植（数字と小数点 1 個まで、符号なし） */
function parseUnsigned(text: string): number | null {
  if (text.length === 0 || text.length > 18) return null;
  if (text.startsWith('.') || text.endsWith('.')) return null;
  if (!/^[0-9]*\.?[0-9]*$/.test(text)) return null;
  return Number(text);
}

/** ReadUtf8File（BOM 除去）＋ ReadAndValidateCsv の移植 */
export function vbaValidateCsv(raw: string): ImportResult {
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const problems: string[] = [];
  const add = (line: number, msg: string) => problems.push(line > 0 ? `CSV 行 ${line}：${msg}` : msg);
  const result: ImportResult = { ok: false, problems, maxPoint: 0, totalCount: 0, sheets: new Map() };

  let rows: string[][];
  try {
    rows = vbaParseCsv(content);
  } catch (e) {
    problems.push(`CSV を読めませんでした。${(e as Error).message}`);
    return result;
  }
  if (rows.length < 2) {
    problems.push('ヘッダーと測定データが必要です。');
    return result;
  }
  const headers = new Map<string, number>();
  for (const [i, h] of rows[0].entries()) {
    const name = h.trim();
    if (!name) { problems.push('ヘッダーに空欄があります。'); return result; }
    const key = name.toLowerCase(); // vbTextCompare
    if (headers.has(key)) { problems.push(`ヘッダーが重複しています：${name}`); return result; }
    headers.set(key, i);
  }
  for (const req of ['RecordID', 'PointID', 'PointName', 'PointNumber', 'Sequence', 'BlowCount', 'PenetrationCm', 'CumulativeDepthCm', 'RecordedAt']) {
    if (!headers.has(req.toLowerCase())) { problems.push(`必須列がありません：${req}`); return result; }
  }
  const cell = (f: string[], name: string) => f[headers.get(name.toLowerCase())!].trim();

  const seen = new Map<string, boolean>();
  const blows = new Map<string, number>();
  const pens = new Map<string, number>();
  const depths = new Map<string, number>();
  const pointIds = new Map<number, string>();
  const counts = new Map<number, number>();
  const recordIds = new Set<string>();
  const pointIdOwners = new Map<string, number>();

  for (let idx = 1; idx < rows.length; idx++) {
    const line = idx + 1;
    const f = rows[idx];
    if (f.every((x) => x.trim().length === 0)) continue;
    if (f.length !== headers.size) { add(line, '列数がヘッダーと一致しません。'); continue; }
    if (result.totalCount >= 2500) { add(line, '測定数が全体上限の 2500 件を超えます。'); continue; }
    let bad = false;
    const recordId = cell(f, 'RecordID');
    const pointId = cell(f, 'PointID');
    const pointName = cell(f, 'PointName');
    const recordedAt = cell(f, 'RecordedAt');
    if (!recordId || !pointId || !pointName || !recordedAt) { add(line, `${pointName}：RecordID、PointID、PointName、RecordedAt は必須です。`); bad = true; }
    const pn = parseUnsigned(cell(f, 'PointNumber'));
    if (pn === null || pn < 1 || pn > 25 || !Number.isInteger(pn)) { add(line, `${pointName}：PointNumber は 1～25 の整数です。`); bad = true; }
    const sq = parseUnsigned(cell(f, 'Sequence'));
    if (sq === null || sq < 1 || sq > 100 || !Number.isInteger(sq)) { add(line, `${pointName}：Sequence は 1～100 の整数です。`); bad = true; }
    const blow = parseUnsigned(cell(f, 'BlowCount'));
    if (blow === null || !Number.isInteger(blow)) { add(line, `${pointName}：BlowCount は 0 以上の整数です。`); bad = true; }
    const pen = parseUnsigned(cell(f, 'PenetrationCm'));
    if (pen === null || pen <= 0) { add(line, `${pointName}：PenetrationCm は正の数です。`); bad = true; }
    const cum = parseUnsigned(cell(f, 'CumulativeDepthCm'));
    if (cum === null || cum <= 0) { add(line, `${pointName}：CumulativeDepthCm は正の数です。`); bad = true; }
    if (bad) continue;

    const point = pn!;
    const seq = sq!;
    if (pointName !== `K-${point}`) { add(line, `${pointName}：PointName と PointNumber が一致しません。`); continue; }
    if (recordIds.has(recordId.toLowerCase())) { add(line, `${pointName}：RecordID が重複しています。`); continue; }
    recordIds.add(recordId.toLowerCase());
    const owner = pointIdOwners.get(pointId.toLowerCase());
    if (owner !== undefined) {
      if (owner !== point) { add(line, `${pointName}：PointID が別地点にも使われています。`); continue; }
    } else {
      pointIdOwners.set(pointId.toLowerCase(), point);
    }
    const existing = pointIds.get(point);
    if (existing && existing !== pointId) { add(line, `${pointName}：同じ地点に異なる PointID があります。`); continue; }
    const key = `${point}:${seq}`;
    if (seen.get(key)) { add(line, `${pointName}：Sequence ${seq} が重複しています。`); continue; }
    pointIds.set(point, pointId);
    seen.set(key, true);
    blows.set(key, blow!);
    pens.set(key, pen!);
    depths.set(key, cum!);
    counts.set(point, (counts.get(point) ?? 0) + 1);
    result.totalCount++;
    if (point > result.maxPoint) result.maxPoint = point;
  }

  if (result.totalCount === 0) add(0, '測定データがありません。');
  for (let point = 1; point <= result.maxPoint; point++) {
    const count = counts.get(point) ?? 0;
    if (count === 0) add(0, `K-${point} の記録がありません。地点は K-1 から連続させてください。`);
    if (count > 100) add(0, `K-${point} が 100 測定を超えています。`);
    let total = 0;
    const sheet: Array<[number, number]> = [];
    for (let seq = 1; seq <= count; seq++) {
      const key = `${point}:${seq}`;
      if (!seen.get(key)) {
        add(0, `K-${point} の Sequence ${seq} が欠けています。`);
        continue;
      }
      total += pens.get(key)!;
      if (Math.abs(depths.get(key)! - total) > 0.000001) add(0, `K-${point} Sequence ${seq}：累積深度が貫入量の合計と一致しません。`);
      if (seq > 1 && seen.get(`${point}:${seq - 1}`) && depths.get(key)! <= depths.get(`${point}:${seq - 1}`)!) {
        add(0, `K-${point} Sequence ${seq}：累積深度が昇順ではありません。`);
      }
      sheet.push([blows.get(key)!, depths.get(key)!]);
    }
    result.sheets.set(point, sheet);
  }
  result.ok = problems.length === 0;
  return result;
}
