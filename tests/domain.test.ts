import { describe, expect, it } from 'vitest';
import { formatDepthM, recalculatePoint } from '../src/domain/depth';
import type { Measurement } from '../src/domain/types';
import { parseBlowCount, parsePenetrationCm } from '../src/domain/validation';

function m(sequence: number, penetrationCm: number, cumulativeDepthCm = 0): Measurement {
  return {
    id: `id-${sequence}`,
    projectId: 'p',
    pointId: 'k',
    sequence,
    blowCount: 1,
    penetrationCm,
    cumulativeDepthCm,
    recordedAt: '',
    updatedAt: '',
  };
}

describe('recalculatePoint', () => {
  it('累積深度を再計算し、変わったものだけ返す', () => {
    const input = [m(1, 10, 10), m(2, 10, 20), m(3, 5, 99)];
    const { all, changed } = recalculatePoint(input);
    expect(all.map((x) => x.cumulativeDepthCm)).toEqual([10, 20, 25]);
    expect(changed.map((x) => x.id)).toEqual(['id-3']);
    expect(input[2].cumulativeDepthCm).toBe(99); // 入力は変更しない
  });

  it('欠番を詰めて振り直す', () => {
    const { all } = recalculatePoint([m(1, 10), m(3, 10), m(4, 5)]);
    expect(all.map((x) => [x.sequence, x.cumulativeDepthCm])).toEqual([[1, 10], [2, 20], [3, 25]]);
  });
});

describe('入力値の変換', () => {
  it('打撃回数', () => {
    expect(parseBlowCount('18')).toEqual({ ok: true, value: 18 });
    expect(parseBlowCount('０')).toEqual({ ok: true, value: 0 });
    expect(parseBlowCount('').ok).toBe(false);
    expect(parseBlowCount('-1').ok).toBe(false);
    expect(parseBlowCount('1.5').ok).toBe(false);
  });

  it('貫入量', () => {
    expect(parsePenetrationCm('7')).toEqual({ ok: true, value: 7 });
    expect(parsePenetrationCm('0').ok).toBe(false);
    expect(parsePenetrationCm('2.5').ok).toBe(false);
  });

  it('深度表示', () => {
    expect(formatDepthM(135)).toBe('1.35');
    expect(formatDepthM(0)).toBe('0.00');
  });
});
