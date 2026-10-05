import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Measurement, Point } from '../src/domain/types';
import { buildJgs1433Xml, depthAxisMax, ndOf, xyDepth } from '../src/export/jgsXml';
import { encodeShiftJis, findNonShiftJis } from '../src/export/sjis';

/** 学習用データ（実案件の電子納品 XML 19 地点。見出しは匿名化済み）。元のソフトが出力した電子納品 XML */
const dir = join(import.meta.dirname, 'fixtures', 'jgs1433');
const original = (n: number) => readFileSync(join(dir, `K-${n}.XML`));

/** 元ファイルから測定値とヘッダーを読み取り、アプリのデータ形式にする */
function load(n: number) {
  const text = new TextDecoder('shift_jis').decode(original(n));
  const get = (tag: string) => text.match(new RegExp(`<${tag}>(.*?)</${tag}>`))![1];
  const rows = [...text.matchAll(/<測定>\r\n<打撃回数>(\d+)<\/打撃回数>\r\n<貫入深さ>(\d+)<\/貫入深さ>\r\n<貫入量>(\d+)<\/貫入量>/g)];
  const point: Point = { id: `p${n}`, projectId: 'x', pointNumber: n, status: 'finished', createdAt: '', finishedAt: null, updatedAt: '' };
  const date = get('試験開始年月日');
  const measurements: Measurement[] = rows.map((r, i) => ({
    id: `m${i}`, projectId: 'x', pointId: point.id, sequence: i + 1,
    blowCount: Number(r[1]), cumulativeDepthCm: Number(r[2]), penetrationCm: Number(r[3]),
    recordedAt: new Date(`${date}T10:00:00`).toISOString(), updatedAt: '',
  }));
  const info = { surveyTitle: get('調査件名'), clientName: get('発注機関名称'), contractorName: get('調査業者名'), testerName: get('試験者') };
  return { text, point, measurements, info };
}

const differingLines = (a: string, b: string) => {
  const al = a.split('\r\n');
  const bl = b.split('\r\n');
  return al.map((l, i) => (l === bl[i] ? null : `${l} ≠ ${bl[i]}`)).filter(Boolean);
};

describe('電子納品 XML（JGS 1433）', () => {
  // 人が手で調整したと思われる地点（上端深度・深度軸）を除き、元ファイルとバイト単位で一致すること
  const exact = [2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 19];
  it.each(exact)('K-%i は元ファイルとバイト単位で一致する', (n) => {
    const { point, measurements, info } = load(n);
    const bytes = encodeShiftJis(buildJgs1433Xml(info, point, measurements));
    expect(Buffer.from(bytes).equals(original(n))).toBe(true);
  });

  it('手で調整された地点は、その箇所だけが違う', () => {
    const diffs = Object.fromEntries([1, 3, 9, 14].map((n) => {
      const { text, point, measurements, info } = load(n);
      return [`K-${n}`, differingLines(text, buildJgs1433Xml(info, point, measurements))];
    }));
    expect(diffs).toEqual({
      'K-1': ['<上端深度>0.10</上端深度> ≠ <上端深度>0.00</上端深度>'],
      'K-3': [expect.stringContaining('<最小値>0.2</最小値>'), expect.stringContaining('<軸交点>0.2</軸交点>')],
      'K-9': ['<最大値>2</最大値> ≠ <最大値>1.5</最大値>'],
      'K-14': ['<最大値>3.5</最大値> ≠ <最大値>4</最大値>'],
    });
  });

  it('Nd・深度表記・深度軸の規則', () => {
    expect([ndOf(50, 7), ndOf(50, 1), ndOf(55, 8), ndOf(50, 3)]).toEqual([71, 500, 69, 167]);
    expect([xyDepth(10), xyDepth(70), xyDepth(195), xyDepth(47), xyDepth(500)]).toEqual(['0.10', '0.700', '1.95', '0.470', '5.00']);
    expect([depthAxisMax(47), depthAxisMax(112), depthAxisMax(200), depthAxisMax(201), depthAxisMax(493)]).toEqual(['1', '1.5', '2', '2.5', '5']);
  });

  it('Shift_JIS に変換できない文字を見つける', () => {
    expect(findNonShiftJis('令和○年度［第○○‐Ｓ○○○○号］')).toBeNull();
    expect(findNonShiftJis('𠮷野家')).toBe('𠮷');
  });

  it('XML 特殊文字はエスケープする', () => {
    const { point, measurements, info } = load(1);
    const xml = buildJgs1433Xml({ ...info, surveyTitle: 'A&B<C>' }, point, measurements);
    expect(xml).toContain('<調査件名>A&amp;B&lt;C&gt;</調査件名>');
  });
});
