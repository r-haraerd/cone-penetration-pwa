import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Measurement, Point } from '../src/domain/types';
import { buildColumnSheetDxf, ndToX } from '../src/export/columnDxf';
import { encodeShiftJis } from '../src/export/sjis';
import { createZip } from '../src/export/zip';

/** 学習用データ（K-1〜K-19.XML）の測定値 */
function learningColumns() {
  return Array.from({ length: 19 }, (_, i) => {
    const n = i + 1;
    const text = new TextDecoder('shift_jis').decode(readFileSync(join(import.meta.dirname, 'fixtures', 'jgs1433', `K-${n}.XML`)));
    const rows = [...text.matchAll(/<測定>\r\n<打撃回数>(\d+)<\/打撃回数>\r\n<貫入深さ>(\d+)<\/貫入深さ>\r\n<貫入量>(\d+)<\/貫入量>/g)];
    const point: Point = { id: `p${n}`, projectId: 'x', pointNumber: n, status: 'finished', createdAt: '', finishedAt: null, updatedAt: '' };
    const measurements: Measurement[] = rows.map((r, j) => ({
      id: `m${j}`, projectId: 'x', pointId: point.id, sequence: j + 1, blowCount: +r[1], cumulativeDepthCm: +r[2], penetrationCm: +r[3], recordedAt: '', updatedAt: '',
    }));
    return { point, measurements };
  });
}
const count = (dxf: string, pattern: RegExp) => (dxf.match(pattern) ?? []).length;

describe('簡易貫入柱状図 DXF', () => {
  it('Nd → 横位置（0.6 倍を 0.25 単位で切り捨て。学習用 DWG と同じ）', () => {
    expect([1, 3, 4, 5, 8, 13, 41, 50].map(ndToX)).toEqual([0.5, 1.75, 2.25, 3, 4.75, 7.75, 24.5, 30]);
  });

  it('学習用データ 19 地点から、学習用 DWG と同じ数の図形・文字ができる', () => {
    const columns = learningColumns();
    const dxf = buildColumnSheetDxf(columns);
    // 学習用 DWG：円 575・塗りつぶし 575・文字 232（tests 外で ezdxf により座標まで照合済み）
    // ＋ 深度目盛の文字（各地点 0.5 m ごと、最終深度まで）
    expect(count(dxf, /\r\n0\r\nCIRCLE\r\n/g)).toBe(575);
    expect(count(dxf, /\r\n70\r\n1\r\n40\r\n1\r\n41\r\n1\r\n/g)).toBe(575);
    const scaleLabels = columns.reduce((n, c) => n + Math.floor(c.measurements[c.measurements.length - 1].cumulativeDepthCm / 50), 0);
    expect(count(dxf, /\r\n0\r\nTEXT\r\n/g)).toBe(232 + scaleLabels);
    expect(dxf).toContain('\r\n$DWGCODEPAGE\r\n3\r\nANSI_932\r\n');
    for (const layer of ['S-TTL', 'S-TTL-GRD', 'S-BGD-BNDR', 'S-BGD-BRG']) expect(dxf).toContain(`\r\n2\r\n${layer}\r\n`);
    expect(dxf).toContain('dep = 2.680 m');
    expect(dxf.endsWith('0\r\nEOF\r\n')).toBe(true);
    expect(() => encodeShiftJis(dxf)).not.toThrow();
  });

  it('深度目盛：0.5 m ごとに枠内の横線と、枠の左に深度を書く', () => {
    const [c] = learningColumns();
    const at = (depthCm: number) => ({ point: c.point, measurements: [{ ...c.measurements[0], cumulativeDepthCm: depthCm }] });
    const label = (y: number, v: string) => `\r\n0\r\nTEXT\r\n8\r\nS-BGD-BRG\r\n10\r\n46\r\n20\r\n${y}\r\n30\r\n0\r\n40\r\n1.05\r\n1\r\n${v}\r\n`;
    const line = (y: number) => `\r\n0\r\nVERTEX\r\n8\r\nS-BGD-BRG\r\n10\r\n46.5\r\n20\r\n${y}\r\n30\r\n0\r\n0\r\nVERTEX\r\n8\r\nS-BGD-BRG\r\n10\r\n76.5\r\n20\r\n${y}\r\n`;
    // 1.20 m：0.5・1.0 の目盛（y = 125 - 10、125 - 20）
    const a = buildColumnSheetDxf([at(120)]);
    expect(a).toContain(label(115, '0.5'));
    expect(a).toContain(label(105, '1.0'));
    expect(a).toContain(line(115));
    expect(a).toContain(line(105));
    expect(a).not.toContain('\r\n1\r\n1.5\r\n');
    // ちょうど 1.00 m：1.0 の文字は書くが、横線は枠の下辺と重なるので引かない
    const b = buildColumnSheetDxf([at(100)]);
    expect(b).toContain(label(105, '1.0'));
    expect(b).not.toContain(line(105));
  });

  it('5 m より深い地点があれば下端線を下げる', () => {
    const [c] = learningColumns();
    const deep = { point: c.point, measurements: Array.from({ length: 62 }, (_, j) => ({ ...c.measurements[0], id: `d${j}`, sequence: j + 1, blowCount: 5, penetrationCm: 10, cumulativeDepthCm: (j + 1) * 10 })) };
    const dxf = buildColumnSheetDxf([deep]);
    // 6.2 m → 7 m まで：下端線 y = 125 - 7*20 = -15
    expect(dxf).toContain('\r\n8\r\nS-BGD-BNDR\r\n66\r\n1\r\n10\r\n0\r\n20\r\n0\r\n30\r\n0\r\n70\r\n0\r\n0\r\nVERTEX\r\n8\r\nS-BGD-BNDR\r\n10\r\n20\r\n20\r\n-15\r\n');
  });

  it('記録のある地点がなければエラー', () => {
    const [c] = learningColumns();
    expect(() => buildColumnSheetDxf([{ point: c.point, measurements: [] }])).toThrow('記録のある地点');
  });
});

describe('ZIP', () => {
  it('中身のファイル名・サイズ・CRC を正しく持つ', () => {
    const files = [{ name: 'K-1.XML', data: new TextEncoder().encode('abc') }, { name: 'K-2.XML', data: new Uint8Array([1, 2, 3, 4]) }];
    const zip = createZip(files, new Date(2026, 9, 5, 12, 0, 0));
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x352441c2); // CRC32("abc")
    expect(new TextDecoder().decode(zip.slice(30, 37))).toBe('K-1.XML');
  });
});
