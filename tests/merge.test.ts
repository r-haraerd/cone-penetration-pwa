import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDatabase } from '../src/db/database';
import { Repository } from '../src/db/repository';
import { conflictsOf, planMerge, resolveMerge, type MatchBy, type Side } from '../src/domain/merge';
import { buildBackup, parseBackup, serializeBackup } from '../src/export/backup';

/** 2 台の端末（代表者 A・メンバー B）を別々の IndexedDB で再現する */
let dbA: FieldDatabase;
let dbB: FieldDatabase;
let A: Repository;
let B: Repository;
let n = 0;
beforeEach(() => {
  n++;
  dbA = new FieldDatabase(`merge-a-${n}`);
  dbB = new FieldDatabase(`merge-b-${n}`);
  A = new Repository(dbA);
  B = new Repository(dbB);
});
afterEach(async () => {
  await dbA.delete();
  await dbB.delete();
});

/** 端末 from のバックアップファイル（JSON 文字列）を作って読み込む */
async function transfer(from: Repository, projectId: string) {
  const text = serializeBackup(buildBackup(await from.getProjectSnapshot(projectId), new Date().toISOString()));
  const parsed = parseBackup(text);
  if (!parsed.ok) throw new Error(parsed.errors.join());
  return parsed.snapshot;
}

/** 端末 to に、incoming を結合する */
async function merge(to: Repository, localProjectId: string, incoming: Awaited<ReturnType<typeof transfer>>, matchBy: MatchBy, choices: Record<number, Side> = {}) {
  const plan = planMerge(await to.getProjectSnapshot(localProjectId), incoming, matchBy);
  const result = resolveMerge(plan, choices, new Date().toISOString());
  await to.applyMerge(result);
  return { plan, result };
}

async function record(repo: Repository, projectId: string, pointNumber: number, data: number[][]) {
  const point = (await repo.listPointSummaries(projectId)).find((p) => p.pointNumber === pointNumber)!;
  for (const [blow, pen] of data) await repo.addMeasurement(point.id, blow, pen);
  return point.id;
}

async function depthsByPoint(repo: Repository, projectId: string) {
  const snap = await repo.getProjectSnapshot(projectId);
  return Object.fromEntries(snap.points.map((p) => [`K-${p.point.pointNumber}`, p.measurements.map((m) => m.cumulativeDepthCm)]));
}

/** 代表者 A が案件を作り、B に配る */
async function distribute(count = 4) {
  const project = await A.createProject('0540', '○○地区地質調査', count);
  await B.importSnapshot(await transfer(A, project.id), false);
  return project;
}

describe('配った案件を分担して記録し、結合する（ID で照合）', () => {
  it('A が K-1・K-2、B が K-3・K-4 を記録 → A で結合すると全地点がそろう', async () => {
    const p = await distribute(4);
    await record(A, p.id, 1, [[5, 10], [8, 10]]);
    await record(A, p.id, 2, [[3, 10]]);
    await record(B, p.id, 3, [[7, 10], [9, 5]]);
    await record(B, p.id, 4, [[2, 10]]);
    const { plan, result } = await merge(A, p.id, await transfer(B, p.id), 'id');
    expect(plan.matchBy).toBe('id');
    expect(conflictsOf(plan)).toEqual([]);
    expect(result.summary.taken).toEqual(['K-3', 'K-4']);
    expect(await depthsByPoint(A, p.id)).toEqual({ 'K-1': [10, 20], 'K-2': [10], 'K-3': [10, 15], 'K-4': [10] });
  });

  it('同じファイルをもう一度結合しても変わらない', async () => {
    const p = await distribute(2);
    await record(B, p.id, 2, [[7, 10]]);
    const file = await transfer(B, p.id);
    await merge(A, p.id, file, 'id');
    const before = await depthsByPoint(A, p.id);
    const { result } = await merge(A, p.id, file, 'id');
    expect(result.summary.taken).toEqual([]);
    expect(await depthsByPoint(A, p.id)).toEqual(before);
  });

  it('B が A の記録に書き足しただけなら、多い方を自動で採用', async () => {
    const p = await distribute(1);
    await record(A, p.id, 1, [[5, 10]]);
    await B.importSnapshot(await transfer(A, p.id), true); // B は A の途中経過を受け取った
    await record(B, p.id, 1, [[6, 10], [7, 5]]);
    const { plan } = await merge(A, p.id, await transfer(B, p.id), 'id');
    expect(plan.items[0]).toMatchObject({ kind: 'take', reason: 'incomingExtends' });
    expect(await depthsByPoint(A, p.id)).toEqual({ 'K-1': [10, 20, 25] });
    // 逆向き（A の方が多い）なら A のまま
    const { plan: back } = await merge(B, p.id, await transfer(A, p.id), 'id');
    expect(back.items[0]).toMatchObject({ kind: 'keep', reason: 'same' });
  });

  it('両方が同じ地点を別々に記録していたら競合。選んだ側が残る', async () => {
    const p = await distribute(2);
    await record(A, p.id, 1, [[5, 10]]);
    await record(B, p.id, 1, [[9, 10], [9, 10]]);
    const file = await transfer(B, p.id);
    const plan = planMerge(await A.getProjectSnapshot(p.id), file, 'id');
    expect(conflictsOf(plan).map((c) => c.pointNumber)).toEqual([1]);
    expect(() => resolveMerge(plan, {}, new Date().toISOString())).toThrow('K-1 の結合方法');
    await merge(A, p.id, file, 'id', { 1: 'local' });
    expect(await depthsByPoint(A, p.id)).toEqual({ 'K-1': [10], 'K-2': [] });
    await merge(A, p.id, file, 'id', { 1: 'incoming' });
    expect(await depthsByPoint(A, p.id)).toEqual({ 'K-1': [10, 20], 'K-2': [] });
  });

  it('片方で修正した記録も競合として扱う（黙って上書きしない）', async () => {
    const p = await distribute(1);
    await record(A, p.id, 1, [[5, 10], [6, 10]]);
    await B.importSnapshot(await transfer(A, p.id), true);
    const [, second] = await B.listMeasurements((await B.listPointSummaries(p.id))[0].id);
    await B.updateMeasurement(second.id, 6, 5); // B で 2 件目を 5cm に修正
    const plan = planMerge(await A.getProjectSnapshot(p.id), await transfer(B, p.id), 'id');
    expect(conflictsOf(plan).length).toBe(1);
  });

  it('B が試験数量を増やして記録した地点は A に追加される', async () => {
    const p = await distribute(2);
    await B.setPointCount(p.id, 4);
    await record(B, p.id, 4, [[3, 10]]);
    const { result } = await merge(A, p.id, await transfer(B, p.id), 'id');
    expect(result.summary.added).toEqual(['K-3', 'K-4']);
    expect(await depthsByPoint(A, p.id)).toEqual({ 'K-1': [], 'K-2': [], 'K-3': [], 'K-4': [10] });
  });

  it('B が地点を終了していれば、結合後も終了になる', async () => {
    const p = await distribute(1);
    const id = await record(B, p.id, 1, [[3, 10]]);
    await B.finishPoint(id);
    await merge(A, p.id, await transfer(B, p.id), 'id');
    expect((await A.listPointSummaries(p.id))[0].status).toBe('finished');
  });

  it('A で番号を入れ替えていても、ID で正しい地点どうしが合わさる', async () => {
    const p = await distribute(3);
    const k2 = (await A.listPointSummaries(p.id))[1];
    await record(B, p.id, 2, [[4, 10]]); // B は K-2 に記録
    await A.movePoint(k2.id, 3); // A で K-2 と K-3 を入れ替え（この地点は A では K-3）
    const { plan } = await merge(A, p.id, await transfer(B, p.id), 'id');
    expect(plan.renumbered).toEqual(expect.arrayContaining([{ localNumber: 3, incomingNumber: 2 }]));
    expect(await depthsByPoint(A, p.id)).toEqual({ 'K-1': [], 'K-2': [], 'K-3': [10] });
  });
});

describe('別々に作った同じ業務番号の案件を結合する（K 番号で照合）', () => {
  it('業務番号が同じ案件を候補として見つけ、K 番号で合わせる', async () => {
    const a = await A.createProject('0540', '○○地区', 3);
    const b = await B.createProject('0540', '○○地区（B）', 3);
    await record(A, a.id, 1, [[5, 10]]);
    await record(B, b.id, 2, [[6, 10]]);
    await record(B, b.id, 3, [[7, 10]]);
    const file = await transfer(B, b.id);
    expect(await A.projectExists(file.project.id)).toBe(false);
    expect((await A.findProjectsByNumber(' 0540 ', file.project.id)).map((p) => p.id)).toEqual([a.id]);
    const { result } = await merge(A, a.id, file, 'projectNumber');
    expect(result.summary.taken).toEqual(['K-2', 'K-3']);
    expect(await depthsByPoint(A, a.id)).toEqual({ 'K-1': [10], 'K-2': [10], 'K-3': [10] });
    expect((await A.getProject(a.id)).projectName).toBe('○○地区'); // 案件名は端末のまま
  });

  it('結合後の CSV 用データは端末の案件・地点 ID にそろう', async () => {
    const a = await A.createProject('0540', 'x', 2);
    const b = await B.createProject('0540', 'x', 2);
    await record(B, b.id, 2, [[6, 10]]);
    await merge(A, a.id, await transfer(B, b.id), 'projectNumber');
    const snap = await A.getProjectSnapshot(a.id);
    const k2 = snap.points[1];
    expect(k2.measurements.every((m) => m.projectId === a.id && m.pointId === k2.point.id)).toBe(true);
    expect(await dbA.points.where('projectId').equals(b.id).count()).toBe(0);
  });
});
