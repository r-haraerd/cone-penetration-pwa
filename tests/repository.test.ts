import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDatabase } from '../src/db/database';
import { DomainError, Repository } from '../src/db/repository';

let db: FieldDatabase;
let repo: Repository;
let dbCounter = 0;

beforeEach(async () => {
  db = new FieldDatabase(`test-${++dbCounter}`);
  repo = new Repository(db);
});

afterEach(async () => {
  await db.delete();
});

/** 試験数量 n の案件を作り、地点を番号順で返す */
async function setup(n = 3) {
  const project = await repo.createProject('0540', '○○地区地質調査', n);
  const points = await repo.listPointSummaries(project.id);
  return { project, points };
}

describe('案件作成と試験数量', () => {
  it('試験数量ぶんの地点 K-1〜K-n が最初から用意される', async () => {
    const { points } = await setup(12);
    expect(points.map((p) => p.pointNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(points.every((p) => p.status === 'active' && p.measurementCount === 0)).toBe(true);
  });

  it('業務番号・調査件名・試験数量（1〜25）は必須', async () => {
    await expect(repo.createProject(' ', 'x', 3)).rejects.toThrow('業務番号');
    await expect(repo.createProject('0540', '', 3)).rejects.toThrow('調査件名');
    await expect(repo.createProject('0540', 'x', 0)).rejects.toThrow('試験数量');
    await expect(repo.createProject('0540', 'x', 26)).rejects.toThrow('試験数量');
    await expect(repo.createProject('0540', 'x', 2.5)).rejects.toThrow('試験数量');
    expect(await db.projects.count()).toBe(0);
    expect(await db.points.count()).toBe(0);
  });

  it('試験数量を増やすと末尾に地点が追加される', async () => {
    const { project } = await setup(3);
    await repo.setPointCount(project.id, 5);
    expect((await repo.listPointSummaries(project.id)).map((p) => p.pointNumber)).toEqual([1, 2, 3, 4, 5]);
    await expect(repo.setPointCount(project.id, 26)).rejects.toThrow('試験数量');
  });

  it('試験数量を減らすと末尾の未測定地点が削除される。記録がある地点は削除しない', async () => {
    const { project, points } = await setup(5);
    await repo.addMeasurement(points[3].id, 5, 10); // K-4 に記録
    await repo.setPointCount(project.id, 4); // K-5 だけ削除
    expect((await repo.listPointSummaries(project.id)).map((p) => p.pointNumber)).toEqual([1, 2, 3, 4]);
    await expect(repo.setPointCount(project.id, 3)).rejects.toThrow('K-4 に記録がある');
    expect((await repo.listPointSummaries(project.id)).length).toBe(4);
  });

  it('一覧には試験数量と記録済み地点数が出る', async () => {
    const { points } = await setup(4);
    await repo.addMeasurement(points[2].id, 5, 10);
    const [summary] = await repo.listProjectSummaries();
    expect([summary.pointCount, summary.measuredPointCount]).toEqual([4, 1]);
  });
});

describe('地点を自由に選んで記録する', () => {
  it('K-1 以外から始めても、複数の地点を並行して記録できる', async () => {
    const { points } = await setup(3);
    const [k1, k2, k3] = points;
    await repo.addMeasurement(k3.id, 5, 10);
    await repo.addMeasurement(k1.id, 7, 10);
    await repo.addMeasurement(k3.id, 8, 10);
    await repo.addMeasurement(k2.id, 9, 5);
    expect((await repo.getPointView(k3.id)).currentDepthCm).toBe(20);
    expect((await repo.getPointView(k1.id)).currentDepthCm).toBe(10);
    expect((await repo.getPointView(k2.id)).currentDepthCm).toBe(5);
  });

  it('5/10, 8/10, 12/10, 50/5 → 10, 20, 30, 35 cm', async () => {
    const { points } = await setup(1);
    for (const [blow, pen] of [[5, 10], [8, 10], [12, 10], [50, 5]]) await repo.addMeasurement(points[0].id, blow, pen);
    const rows = await repo.listMeasurements(points[0].id);
    expect(rows.map((r) => [r.sequence, r.blowCount, r.penetrationCm, r.cumulativeDepthCm])).toEqual([
      [1, 5, 10, 10], [2, 8, 10, 20], [3, 12, 10, 30], [4, 50, 5, 35],
    ]);
    const view = await repo.getPointView(points[0].id);
    expect([view.currentDepthCm, view.measurementCount]).toEqual([35, 4]);
    expect(view.recent.map((r) => r.sequence)).toEqual([4, 3, 2, 1]);
  });

  it('打撃回数 0（自沈）も記録できる', async () => {
    const { points } = await setup(1);
    expect((await repo.addMeasurement(points[0].id, 0, 5)).cumulativeDepthCm).toBe(5);
  });

  it('不正な値は保存しない', async () => {
    const { points } = await setup(1);
    const id = points[0].id;
    await expect(repo.addMeasurement(id, -1, 10)).rejects.toBeInstanceOf(DomainError);
    await expect(repo.addMeasurement(id, 1.5, 10)).rejects.toBeInstanceOf(DomainError);
    await expect(repo.addMeasurement(id, 3, 0)).rejects.toBeInstanceOf(DomainError);
    expect(await db.measurements.count()).toBe(0);
  });

  it('1 地点 100 件まで', async () => {
    const { points } = await setup(1);
    for (let i = 0; i < 100; i++) await repo.addMeasurement(points[0].id, 1, 10);
    await expect(repo.addMeasurement(points[0].id, 1, 10)).rejects.toThrow('最大 100 件');
    expect((await repo.getPointView(points[0].id)).currentDepthCm).toBe(1000);
  });
});

describe('地点の終了と再開', () => {
  it('記録のない地点は終了できない。終了後は追加できず、再開すると続きから記録できる', async () => {
    const { points } = await setup(2);
    const k1 = points[0].id;
    await expect(repo.finishPoint(k1)).rejects.toThrow('1 件もない');
    await repo.addMeasurement(k1, 5, 10);
    await repo.finishPoint(k1);
    await expect(repo.addMeasurement(k1, 5, 10)).rejects.toThrow('終了済み');
    // 他の地点は K-1 の終了と関係なく記録できる
    await repo.addMeasurement(points[1].id, 3, 10);
    await repo.reopenPoint(k1);
    const m = await repo.addMeasurement(k1, 6, 10);
    expect([m.sequence, m.cumulativeDepthCm]).toEqual([2, 20]);
    expect((await repo.getPointView(k1)).point.finishedAt).toBeNull();
  });
});

describe('案件の並び順', () => {
  it('更新の新しい順に並ぶ', async () => {
    const a = await repo.createProject('A', 'a', 1);
    await new Promise((r) => setTimeout(r, 5));
    await repo.createProject('B', 'b', 1);
    await new Promise((r) => setTimeout(r, 5));
    const [ka] = await repo.listPointSummaries(a.id);
    await repo.addMeasurement(ka.id, 1, 10);
    expect((await repo.listProjectSummaries()).map((p) => p.projectNumber)).toEqual(['A', 'B']);
  });

  it('案件ごとに独立した K-1〜', async () => {
    const a = await repo.createProject('A', 'a', 2);
    const b = await repo.createProject('B', 'b', 3);
    expect((await repo.listPointSummaries(a.id)).length).toBe(2);
    expect((await repo.listPointSummaries(b.id)).map((p) => p.pointNumber)).toEqual([1, 2, 3]);
  });
});
