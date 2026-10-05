import { recalculatePoint } from './depth';
import { pointNameOf, type Measurement, type Point, type Project, type ProjectSnapshot } from './types';

/**
 * 複数の端末で分担して記録した同じ案件を、1 台に結合するための判定（画面・DB に依存しない純粋な処理）。
 *
 * 照合方法
 * - 'id'            : 案件 ID が同じ（代表者が作った案件をバックアップで配った場合）。地点も ID で照合し、
 *                     ID で見つからない地点は K 番号で照合する（各端末で試験数量を増やした場合など）。
 * - 'projectNumber' : 業務番号が同じ別の案件（それぞれが案件を作った場合）。地点は K 番号で照合する。
 *
 * 地点ごとの判定
 * - 片方にしか記録がない                   → 記録がある方
 * - 両方同じ内容                           → 変更なし
 * - 片方がもう片方の記録に書き足しただけ   → 多い方
 * - 両方が別々に記録・修正している         → 競合（利用者がどちらを残すか選ぶ）
 * 地点番号と案件名は、結合する側（この端末）のものを使う。
 */

export type MatchBy = 'id' | 'projectNumber';
export type Side = 'local' | 'incoming';

interface PointData {
  point: Point;
  measurements: Measurement[];
}

export type PointMergeItem =
  /** この端末にない地点：追加する */
  | { kind: 'add'; pointNumber: number; incoming: PointData }
  /** 取り込むファイルの記録を採用する */
  | { kind: 'take'; pointNumber: number; local: PointData; incoming: PointData; reason: 'localEmpty' | 'incomingExtends' }
  /** この端末のまま */
  | { kind: 'keep'; pointNumber: number; local: PointData; incoming: PointData | null; reason: 'same' | 'incomingEmpty' | 'localExtends' | 'notInFile' }
  /** 両方で別々に記録・修正されている */
  | { kind: 'conflict'; pointNumber: number; local: PointData; incoming: PointData };

export interface MergePlan {
  project: Project;
  matchBy: MatchBy;
  items: PointMergeItem[];
  /** ID で照合した地点のうち、番号が端末とファイルで違うもの（端末の番号を使う） */
  renumbered: Array<{ localNumber: number; incomingNumber: number }>;
  /** 照合先がなく、番号も端末で使われているため取り込めない地点（ファイル側の番号）。記録がある場合だけ */
  skipped: number[];
}

export function planMerge(local: ProjectSnapshot, incoming: ProjectSnapshot, matchBy: MatchBy): MergePlan {
  const items: PointMergeItem[] = [];
  const renumbered: MergePlan['renumbered'] = [];
  const skipped: number[] = [];
  const unmatchedIncoming = new Map(incoming.points.map((p) => [p.point.id, p]));
  const pairs: Array<[PointData, PointData | null]> = [];

  const localByNumber = new Map(local.points.map((p) => [p.point.pointNumber, p]));
  const matchedLocal = new Set<string>();

  if (matchBy === 'id') {
    for (const lp of local.points) {
      const ip = unmatchedIncoming.get(lp.point.id);
      if (ip) {
        pairs.push([lp, ip]);
        matchedLocal.add(lp.point.id);
        unmatchedIncoming.delete(ip.point.id);
        if (ip.point.pointNumber !== lp.point.pointNumber) {
          renumbered.push({ localNumber: lp.point.pointNumber, incomingNumber: ip.point.pointNumber });
        }
      }
    }
  }
  // ID で見つからなかった地点は K 番号で照合する
  for (const ip of [...unmatchedIncoming.values()]) {
    const lp = localByNumber.get(ip.point.pointNumber);
    if (lp && !matchedLocal.has(lp.point.id)) {
      pairs.push([lp, ip]);
      matchedLocal.add(lp.point.id);
      unmatchedIncoming.delete(ip.point.id);
    }
  }
  for (const lp of local.points) {
    if (!matchedLocal.has(lp.point.id)) pairs.push([lp, null]);
  }

  for (const [lp, ip] of pairs) items.push(judgePoint(lp, ip));

  // 端末にない地点は、端末で空いている番号ならその番号で追加する
  const usedNumbers = new Set(local.points.map((p) => p.point.pointNumber));
  for (const ip of unmatchedIncoming.values()) {
    const n = ip.point.pointNumber;
    if (!usedNumbers.has(n)) {
      usedNumbers.add(n);
      items.push({ kind: 'add', pointNumber: n, incoming: ip });
    } else if (ip.measurements.length > 0) {
      skipped.push(n); // 黙って捨てず、画面で知らせる
    }
  }

  items.sort((a, b) => a.pointNumber - b.pointNumber);
  return { project: local.project, matchBy, items, renumbered, skipped: skipped.sort((a, b) => a - b) };
}

function judgePoint(lp: PointData, ip: PointData | null): PointMergeItem {
  const pointNumber = lp.point.pointNumber;
  if (!ip) return { kind: 'keep', pointNumber, local: lp, incoming: null, reason: 'notInFile' };
  const L = lp.measurements;
  const I = ip.measurements;
  if (I.length === 0) return { kind: 'keep', pointNumber, local: lp, incoming: ip, reason: L.length === 0 ? 'same' : 'incomingEmpty' };
  if (L.length === 0) return { kind: 'take', pointNumber, local: lp, incoming: ip, reason: 'localEmpty' };
  if (isPrefix(L, I)) {
    return L.length === I.length
      ? { kind: 'keep', pointNumber, local: lp, incoming: ip, reason: 'same' }
      : { kind: 'take', pointNumber, local: lp, incoming: ip, reason: 'incomingExtends' };
  }
  if (isPrefix(I, L)) return { kind: 'keep', pointNumber, local: lp, incoming: ip, reason: 'localExtends' };
  return { kind: 'conflict', pointNumber, local: lp, incoming: ip };
}

/** a の記録が、b の先頭から同じ ID・同じ値で並んでいるか */
function isPrefix(a: Measurement[], b: Measurement[]): boolean {
  if (a.length > b.length) return false;
  return a.every((m, i) => sameRecord(m, b[i]));
}

function sameRecord(a: Measurement, b: Measurement): boolean {
  return a.id === b.id && a.blowCount === b.blowCount && a.penetrationCm === b.penetrationCm;
}

export function conflictsOf(plan: MergePlan): Array<Extract<PointMergeItem, { kind: 'conflict' }>> {
  return plan.items.filter((i): i is Extract<PointMergeItem, { kind: 'conflict' }> => i.kind === 'conflict');
}

export interface MergeResult {
  /** 書き込む地点（端末の案件 ID・地点 ID に付け替え済み） */
  points: Array<{ point: Point; measurements: Measurement[] }>;
  /** 画面に出す要約 */
  summary: { added: string[]; taken: string[]; kept: string[]; unchanged: string[] };
}

/**
 * 判定と競合の選択結果から、書き込む内容を作る。
 * 取り込む記録は端末の地点 ID に付け替え、測定順と累積深度を再計算する。
 */
export function resolveMerge(plan: MergePlan, choices: Record<number, Side>, now: string): MergeResult {
  const projectId = plan.project.id;
  const summary: MergeResult['summary'] = { added: [], taken: [], kept: [], unchanged: [] };
  const points: MergeResult['points'] = [];

  const adopt = (target: Point, source: PointData): { point: Point; measurements: Measurement[] } => {
    const measurements = recalculatePoint(
      source.measurements.map((m) => ({ ...m, projectId, pointId: target.id })),
    ).all;
    return {
      point: { ...target, status: source.point.status, finishedAt: source.point.finishedAt, updatedAt: now },
      measurements,
    };
  };

  for (const item of plan.items) {
    const name = pointNameOf(item.pointNumber);
    switch (item.kind) {
      case 'add': {
        const point: Point = { ...item.incoming.point, projectId, pointNumber: item.pointNumber };
        points.push(adopt(point, item.incoming));
        summary.added.push(name);
        break;
      }
      case 'take':
        points.push(adopt(item.local.point, item.incoming));
        summary.taken.push(name);
        break;
      case 'keep': {
        // 同じ内容でも、ファイル側だけ「終了」にしていれば終了にそろえる
        const finishedElsewhere = item.reason === 'same' && item.incoming?.point.status === 'finished' && item.local.point.status !== 'finished';
        if (finishedElsewhere && item.incoming) {
          points.push(adopt(item.local.point, item.incoming));
        }
        (item.reason === 'same' || item.reason === 'notInFile' || item.reason === 'incomingEmpty' ? summary.unchanged : summary.kept).push(name);
        break;
      }
      case 'conflict': {
        const side = choices[item.pointNumber];
        if (side !== 'local' && side !== 'incoming') throw new Error(`${name} の結合方法が選ばれていません`);
        if (side === 'incoming') {
          points.push(adopt(item.local.point, item.incoming));
          summary.taken.push(name);
        } else {
          summary.kept.push(name);
        }
        break;
      }
    }
  }
  return { points, summary };
}
