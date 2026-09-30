import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDatabase } from '../src/db/database';
import { Repository } from '../src/db/repository';

let db: FieldDatabase;
let repo: Repository;
let dbCounter = 0;

beforeEach(() => {
  db = new FieldDatabase(`edit-test-${++dbCounter}`);
  repo = new Repository(db);
});
afterEach(async () => {
  await db.delete();
});

/** 依頼書 27 のデータ：5/10, 8/10, 12/10, 50/5 */
async function setupK1() {
  const project = await repo.createProject('0540', '○○地区地質調査', 1);
  const [point] = await repo.listPointSummaries(project.id);
  const ids: string[] = [];
  for (const [blow, pen] of [[5, 10], [8, 10], [12, 10], [50, 5]]) {
    ids.push((await repo.addMeasurement(point.id, blow, pen)).id);
  }
  return { project, point, ids };
}

async function rows(pointId: string) {
  return (await repo.listMeasurements(pointId)).map((m) => [m.sequence, m.blowCount, m.penetrationCm, m.cumulativeDepthCm]);
}

describe('測定の修正', () => {
  it('2 件目を 10 cm → 5 cm にすると 10, 15, 25, 30 に再計算される', async () => {
    const { point, ids } = await setupK1();
    const updated = await repo.updateMeasurement(ids[1], 8, 5);
    expect(updated.cumulativeDepthCm).toBe(15);
    expect((await rows(point.id)).map((r) => r[3])).toEqual([10, 15, 25, 30]);
    // 元に戻すと元の深度に戻る
    await repo.updateMeasurement(ids[1], 8, 10);
    expect((await rows(point.id)).map((r) => r[3])).toEqual([10, 20, 30, 35]);
  });

  it('打撃回数だけの修正では深度は変わらない', async () => {
    const { point, ids } = await setupK1();
    await repo.updateMeasurement(ids[2], 13, 10);
    expect(await rows(point.id)).toEqual([
      [1, 5, 10, 10], [2, 8, 10, 20], [3, 13, 10, 30], [4, 50, 5, 35],
    ]);
  });

  it('終了済みの地点でも修正でき、不正値は拒否して何も変えない', async () => {
    const { point, ids } = await setupK1();
    await repo.finishPoint(point.id);
    await repo.updateMeasurement(ids[0], 6, 10);
    expect((await rows(point.id))[0]).toEqual([1, 6, 10, 10]);
    await expect(repo.updateMeasurement(ids[0], -1, 10)).rejects.toThrow();
    await expect(repo.updateMeasurement(ids[0], 6, 0)).rejects.toThrow();
    expect((await rows(point.id))[0]).toEqual([1, 6, 10, 10]);
  });

  it('修正画面用の情報（直前深度と後続件数）', async () => {
    const { ids } = await setupK1();
    const view = await repo.getMeasurementView(ids[1]);
    expect(view.previousDepthCm).toBe(10);
    expect(view.followingCount).toBe(2);
  });
});

describe('測定の削除', () => {
  it('2 件目を削除すると測定順と累積深度が振り直される', async () => {
    const { point, ids } = await setupK1();
    await repo.deleteMeasurement(ids[1]);
    expect(await rows(point.id)).toEqual([
      [1, 5, 10, 10], [2, 12, 10, 20], [3, 50, 5, 25],
    ]);
  });

  it('先頭・末尾の削除', async () => {
    const { point, ids } = await setupK1();
    await repo.deleteMeasurement(ids[3]);
    expect((await rows(point.id)).map((r) => r[3])).toEqual([10, 20, 30]);
    await repo.deleteMeasurement(ids[0]);
    expect(await rows(point.id)).toEqual([[1, 8, 10, 10], [2, 12, 10, 20]]);
    expect((await repo.getPointView(point.id)).currentDepthCm).toBe(20);
  });

  it('削除後に追加すると続きの番号・深度になる', async () => {
    const { point, ids } = await setupK1();
    await repo.deleteMeasurement(ids[1]);
    const added = await repo.addMeasurement(point.id, 30, 10);
    expect([added.sequence, added.cumulativeDepthCm]).toEqual([4, 35]);
  });

  it('同じ記録を 2 回削除してもエラーにならない', async () => {
    const { ids } = await setupK1();
    await repo.deleteMeasurement(ids[0]);
    await expect(repo.deleteMeasurement(ids[0])).resolves.toBeUndefined();
  });
});

describe('地点番号の入れ替えと記録の全削除', () => {
  async function threePoints() {
    const project = await repo.createProject('0540', 'x', 3);
    const pts = await repo.listPointSummaries(project.id);
    for (const [i, p] of pts.entries()) await repo.addMeasurement(p.id, i + 1, 10);
    return { project, pts };
  }
  const blowsByNumber = async (projectId: string) =>
    Promise.all((await repo.listPointSummaries(projectId)).map(async (p) => [p.pointNumber, (await repo.listMeasurements(p.id))[0]?.blowCount ?? null]));

  it('使用中の番号を指定すると記録ごと入れ替わる', async () => {
    const { project, pts } = await threePoints();
    const r = await repo.movePoint(pts[2].id, 1); // K-3 ⇔ K-1
    expect(r.swappedWith).toBe(3);
    expect(await blowsByNumber(project.id)).toEqual([[1, 3], [2, 2], [3, 1]]);
  });

  it('試験数量を超える番号や同じ番号は変更しない', async () => {
    const { project, pts } = await threePoints();
    await expect(repo.movePoint(pts[0].id, 4)).rejects.toThrow('1～3');
    expect((await repo.movePoint(pts[0].id, 1)).swappedWith).toBeNull();
    expect(await blowsByNumber(project.id)).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it('記録の全削除で未測定に戻り、地点は残る', async () => {
    const { project, pts } = await threePoints();
    await repo.finishPoint(pts[1].id);
    await repo.clearPoint(pts[1].id);
    const k2 = await repo.getPointView(pts[1].id);
    expect([k2.measurementCount, k2.point.status]).toEqual([0, 'active']);
    expect((await repo.listPointSummaries(project.id)).length).toBe(3);
    expect((await repo.addMeasurement(pts[1].id, 9, 10)).sequence).toBe(1);
  });
});
