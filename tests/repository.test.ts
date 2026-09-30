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

async function setupPoint() {
  const project = await repo.createProject('0540', '○○地区地質調査');
  const point = await repo.startNextPoint(project.id);
  return { project, point };
}

describe('測定の追加と累積深度', () => {
  it('5/10, 8/10, 12/10, 50/5 → 10, 20, 30, 35 cm', async () => {
    const { point } = await setupPoint();
    for (const [blow, pen] of [[5, 10], [8, 10], [12, 10], [50, 5]]) {
      await repo.addMeasurement(point.id, blow, pen);
    }
    const rows = await db.measurements.where('pointId').equals(point.id).sortBy('sequence');
    expect(rows.map((r) => [r.sequence, r.blowCount, r.penetrationCm, r.cumulativeDepthCm])).toEqual([
      [1, 5, 10, 10],
      [2, 8, 10, 20],
      [3, 12, 10, 30],
      [4, 50, 5, 35],
    ]);
    const view = await repo.getPointView(point.id);
    expect(view.currentDepthCm).toBe(35);
    expect(view.measurementCount).toBe(4);
    expect(view.recent.map((r) => r.sequence)).toEqual([4, 3, 2, 1]);
  });

  it('打撃回数 0（自沈）も記録できる', async () => {
    const { point } = await setupPoint();
    const m = await repo.addMeasurement(point.id, 0, 5);
    expect(m.cumulativeDepthCm).toBe(5);
  });

  it('不正な値は保存しない', async () => {
    const { point } = await setupPoint();
    await expect(repo.addMeasurement(point.id, -1, 10)).rejects.toBeInstanceOf(DomainError);
    await expect(repo.addMeasurement(point.id, 1.5, 10)).rejects.toBeInstanceOf(DomainError);
    await expect(repo.addMeasurement(point.id, 3, 0)).rejects.toBeInstanceOf(DomainError);
    expect(await db.measurements.count()).toBe(0);
  });

  it('1 地点 100 件まで', async () => {
    const { point } = await setupPoint();
    for (let i = 0; i < 100; i++) await repo.addMeasurement(point.id, 1, 10);
    await expect(repo.addMeasurement(point.id, 1, 10)).rejects.toThrow('最大 100 件');
    expect((await repo.getPointView(point.id)).currentDepthCm).toBe(1000);
  });

  it('終了した地点には追加できない', async () => {
    const { point } = await setupPoint();
    await repo.addMeasurement(point.id, 5, 10);
    await repo.finishPoint(point.id);
    await expect(repo.addMeasurement(point.id, 5, 10)).rejects.toThrow('終了済み');
  });
});

describe('地点の採番', () => {
  it('K-1 から自動採番し、測定中の地点がある間は次を開始できない', async () => {
    const { project, point } = await setupPoint();
    expect(point.pointNumber).toBe(1);
    await expect(repo.startNextPoint(project.id)).rejects.toThrow('K-1 が測定中');
    await expect(repo.finishPoint(point.id)).rejects.toThrow('1 件もない');
    await repo.addMeasurement(point.id, 5, 10);
    await repo.finishPoint(point.id);
    const second = await repo.startNextPoint(project.id);
    expect(second.pointNumber).toBe(2);
  });

  it('25 地点まで', async () => {
    const project = await repo.createProject('0541', '△△地区斜面調査');
    for (let i = 1; i <= 25; i++) {
      const p = await repo.startNextPoint(project.id);
      expect(p.pointNumber).toBe(i);
      await repo.addMeasurement(p.id, 1, 10);
      await repo.finishPoint(p.id);
    }
    await expect(repo.startNextPoint(project.id)).rejects.toThrow('最大 25 地点');
    const summaries = await repo.listProjectSummaries();
    expect(summaries[0].pointCount).toBe(25);
  });

  it('案件ごとに独立して採番する', async () => {
    const a = await repo.createProject('A', 'a');
    const b = await repo.createProject('B', 'b');
    expect((await repo.startNextPoint(a.id)).pointNumber).toBe(1);
    expect((await repo.startNextPoint(b.id)).pointNumber).toBe(1);
  });
});

describe('案件', () => {
  it('業務番号と案件名は必須', async () => {
    await expect(repo.createProject(' ', 'x')).rejects.toThrow('業務番号');
    await expect(repo.createProject('0540', '')).rejects.toThrow('案件名');
  });

  it('更新の新しい順に並ぶ', async () => {
    const a = await repo.createProject('A', 'a');
    await new Promise((r) => setTimeout(r, 5));
    await repo.createProject('B', 'b');
    await new Promise((r) => setTimeout(r, 5));
    await repo.startNextPoint(a.id);
    expect((await repo.listProjectSummaries()).map((p) => p.projectNumber)).toEqual(['A', 'B']);
  });
});
