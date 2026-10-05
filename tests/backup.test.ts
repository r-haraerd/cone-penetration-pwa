import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDatabase } from '../src/db/database';
import { Repository } from '../src/db/repository';
import { buildBackup, parseBackup, serializeBackup, type BackupFileV1 } from '../src/export/backup';

let db: FieldDatabase;
let repo: Repository;
let n = 0;
beforeEach(() => {
  db = new FieldDatabase(`backup-test-${++n}`);
  repo = new Repository(db);
});
afterEach(async () => {
  await db.delete();
});

async function sampleProject() {
  const project = await repo.createProject('0540', '○○地区地質調査', 2);
  const [k1, k2] = await repo.listPointSummaries(project.id);
  for (const [b, p] of [[5, 10], [8, 10], [12, 10], [50, 5]]) await repo.addMeasurement(k1.id, b, p);
  await repo.finishPoint(k1.id);
  await repo.addMeasurement(k2.id, 7, 10);
  return project;
}

async function exportJson(projectId: string): Promise<string> {
  return serializeBackup(buildBackup(await repo.getProjectSnapshot(projectId), new Date().toISOString()));
}

describe('JSON バックアップ', () => {
  it('schemaVersion と入れ子構造で書き出される', async () => {
    const project = await sampleProject();
    const json = JSON.parse(await exportJson(project.id)) as BackupFileV1;
    expect(json.schemaVersion).toBe(1);
    expect(json.project.projectNumber).toBe('0540');
    expect(json.points.map((p) => [p.pointName, p.status, p.measurements.length])).toEqual([['K-1', 'finished', 4], ['K-2', 'active', 1]]);
    expect(json.points[0].measurements[3]).toMatchObject({ sequence: 4, blowCount: 50, penetrationCm: 5, cumulativeDepthCm: 35 });
  });

  it('端末紛失 → 別端末で復元すると全データが元どおりになる', async () => {
    const project = await sampleProject();
    const before = await repo.getProjectSnapshot(project.id);
    const text = await exportJson(project.id);

    const otherDb = new FieldDatabase(`backup-other-${n}`);
    const other = new Repository(otherDb);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await other.importSnapshot(parsed.snapshot, false);
    const after = await other.getProjectSnapshot(project.id);
    expect(after.points).toEqual(before.points);
    expect(after.project).toMatchObject({ id: project.id, projectNumber: '0540', projectName: '○○地区地質調査' });
    // 復元後もそのまま測定を続けられる
    const k2 = after.points[1].point;
    const m = await other.addMeasurement(k2.id, 9, 10);
    expect([m.sequence, m.cumulativeDepthCm]).toEqual([2, 20]);
    await otherDb.delete();
  });

  it('同じ案件がある場合は置き換えを指定しない限り書き込まない', async () => {
    const project = await sampleProject();
    const text = await exportJson(project.id);
    const k2 = (await repo.listPointSummaries(project.id))[1];
    await repo.addMeasurement(k2.id, 1, 10); // バックアップ後に追加
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse failed');
    await expect(repo.importSnapshot(parsed.snapshot, false)).rejects.toThrow('既にこの端末');
    expect((await repo.getPointView(k2.id)).measurementCount).toBe(2);
    await repo.importSnapshot(parsed.snapshot, true);
    expect((await repo.getPointView(k2.id)).measurementCount).toBe(1);
  });

  it('置き換えで消えた地点・測定が残らない', async () => {
    const project = await sampleProject();
    const text = await exportJson(project.id);
    await repo.setPointCount(project.id, 3);
    const k3 = (await repo.listPointSummaries(project.id))[2];
    await repo.addMeasurement(k3.id, 1, 10);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse failed');
    await repo.importSnapshot(parsed.snapshot, true);
    expect((await repo.listPointSummaries(project.id)).map((p) => p.pointNumber)).toEqual([1, 2]);
    expect(await db.measurements.where('pointId').equals(k3.id).count()).toBe(0);
  });
});

describe('壊れた・不正な JSON を読み込んでも既存データを壊さない', () => {
  async function tamper(mutate: (b: BackupFileV1) => void): Promise<string[]> {
    const project = await sampleProject();
    const backup = JSON.parse(await exportJson(project.id)) as BackupFileV1;
    mutate(backup);
    const r = parseBackup(JSON.stringify(backup));
    expect(r.ok).toBe(false);
    return r.ok ? [] : r.errors;
  }

  it('JSON として壊れている', async () => {
    const project = await sampleProject();
    const text = await exportJson(project.id);
    const r = parseBackup(text.slice(0, text.length / 2));
    expect(r.ok).toBe(false);
    expect(await db.measurements.count()).toBe(5);
  });

  it('別のファイル・バージョン違い', () => {
    expect(parseBackup('{"hello":1}')).toMatchObject({ ok: false });
    expect(parseBackup('[]')).toMatchObject({ ok: false });
    const future = parseBackup(JSON.stringify({ schemaVersion: 99 }));
    expect(future.ok ? '' : future.errors[0]).toContain('新しいバージョン');
  });

  it.each<[string, (b: BackupFileV1) => void, string]>([
    ['必須フィールド欠落', (b) => delete (b.project as Partial<BackupFileV1['project']>).projectNumber, 'projectNumber'],
    ['型違い（打撃回数が文字列）', (b) => ((b.points[0].measurements[0] as unknown as Record<string, unknown>).blowCount = '5'), 'blowCount'],
    ['負の打撃回数', (b) => (b.points[0].measurements[0].blowCount = -1), 'blowCount'],
    ['貫入量 0', (b) => (b.points[0].measurements[0].penetrationCm = 0), 'penetrationCm'],
    ['累積深度の不整合', (b) => (b.points[0].measurements[2].cumulativeDepthCm = 99), '累積深度'],
    ['測定順の欠番', (b) => (b.points[0].measurements[3].sequence = 6), '測定順'],
    ['地点番号の重複', (b) => (b.points[1].pointNumber = 1), '重複'],
    ['ID の重複', (b) => (b.points[1].measurements[0].id = b.points[0].measurements[0].id), 'ID が重複'],
    ['ID 形式不正', (b) => (b.points[0].id = 'x'), 'ID 形式'],
    ['地点番号 26', (b) => (b.points[1].pointNumber = 26), 'pointNumber'],
    ['日時不正', (b) => (b.points[0].measurements[0].recordedAt = 'yesterday'), 'recordedAt'],
  ])('%s', async (_label, mutate, fragment) => {
    const errors = await tamper(mutate);
    expect(errors.join('\n')).toContain(fragment);
    expect(await db.measurements.count()).toBe(5); // 既存データはそのまま
  });
});

describe('案件の削除', () => {
  it('地点・測定も含めて削除され、他の案件は残る', async () => {
    const a = await sampleProject();
    const b = await repo.createProject('0541', 'b', 1);
    await repo.deleteProject(a.id);
    expect(await db.points.where('projectId').equals(a.id).count()).toBe(0);
    expect(await db.measurements.count()).toBe(0);
    expect(await db.points.where('projectId').equals(b.id).count()).toBe(1);
    expect((await repo.listProjectSummaries()).map((p) => p.id)).toEqual([b.id]);
  });
});
