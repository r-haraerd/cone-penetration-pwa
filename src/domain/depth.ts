import type { Measurement } from './types';

/**
 * 地点内の測定を測定順に並べ直し、sequence を 1 から振り直し、
 * cumulativeDepthCm を貫入量の累計として再計算する。
 * 追加・修正・削除のすべてがこの関数を通るので、累積深度の整合性はここだけで保証される。
 * 入力配列は変更せず、変更が必要なレコードだけを新しいオブジェクトで返す。
 */
export function recalculatePoint(measurements: readonly Measurement[]): {
  all: Measurement[];
  changed: Measurement[];
} {
  const sorted = [...measurements].sort((a, b) => a.sequence - b.sequence);
  const all: Measurement[] = [];
  const changed: Measurement[] = [];
  let depth = 0;
  sorted.forEach((m, index) => {
    depth += m.penetrationCm;
    const sequence = index + 1;
    if (m.sequence === sequence && m.cumulativeDepthCm === depth) {
      all.push(m);
    } else {
      const updated = { ...m, sequence, cumulativeDepthCm: depth };
      all.push(updated);
      changed.push(updated);
    }
  });
  return { all, changed };
}

/** 画面表示用：cm 整数 → "1.35" (m, 小数 2 桁) */
export function formatDepthM(depthCm: number): string {
  return (depthCm / 100).toFixed(2);
}
