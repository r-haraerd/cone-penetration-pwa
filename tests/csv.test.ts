import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldDatabase } from '../src/db/database';
import { Repository } from '../src/db/repository';
import { buildExcelCsv, checkCsvReadiness, csvField } from '../src/export/csv';
import { vbaValidateCsv } from './helpers/fieldDataImportRules';

const fixtures = join(import.meta.dirname, 'fixtures');
const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf8');

describe('取込マクロ移植の妥当性（Excel 実機で検証済みの CSV と同じ判定になること）', () => {
  it('sample_field_data.csv は受け付け、Excel 実機と同じ B/C 値になる', () => {
    const r = vbaValidateCsv(fixture('sample_field_data.csv'));
    expect(r.problems).toEqual([]);
    expect(r.maxPoint).toBe(2);
    expect(r.sheets.get(1)).toEqual([[5, 10], [8, 20], [12, 30], [50, 35]]);
    expect(r.sheets.get(2)).toEqual([[7, 10], [9, 20]]);
  });

  // test_field_import_validation.py で Excel が拒否したケースと、エラー文に含まれる語
  const rejected: Record<string, string> = {
    'validation_duplicate_record.csv': 'RecordID',
    'validation_wrong_point.csv': 'PointName',
    'validation_bad_blow.csv': 'BlowCount',
    'validation_zero_penetration.csv': 'PenetrationCm',
    'validation_bad_depth.csv': 'Sequence 3',
    'validation_missing_sequence.csv': 'Sequence 2',
    'validation_missing_required.csv': 'RecordedAt',
    'validation_missing_column.csv': 'PointID',
  };
  it.each(Object.entries(rejected))('%s は拒否される', (file, fragment) => {
    const r = vbaValidateCsv(fixture(file));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toContain(fragment);
  });

  it('fixtures の CSV をすべて検査対象にしている', () => {
    const csvs = readdirSync(fixtures).filter((f) => f.startsWith('validation_'));
    expect(csvs.sort()).toEqual(Object.keys(rejected).sort());
  });
});

let db: FieldDatabase;
let repo: Repository;
let n = 0;
beforeEach(() => {
  db = new FieldDatabase(`csv-test-${++n}`);
  repo = new Repository(db);
});
afterEach(async () => {
  await db.delete();
});

async function buildProject(pointsData: number[][][], projectNumber = '0540') {
  const project = await repo.createProject(projectNumber, '○○地区地質調査');
  for (const data of pointsData) {
    const point = await repo.startNextPoint(project.id);
    for (const [blow, pen] of data) await repo.addMeasurement(point.id, blow, pen);
    if (data.length > 0) await repo.finishPoint(point.id);
  }
  return project;
}

describe('PWA の CSV 出力', () => {
  it('取込マクロの検証を通り、Excel の B/C 列に正しい値が入る', async () => {
    const project = await buildProject([
      [[5, 10], [8, 10], [12, 10], [50, 5]],
      [[7, 10], [9, 10]],
      [[0, 5], [3, 7]],
    ]);
    const snapshot = await repo.getProjectSnapshot(project.id);
    expect(checkCsvReadiness(snapshot).errors).toEqual([]);
    const csv = buildExcelCsv(snapshot);
    const r = vbaValidateCsv(csv);
    expect(r.problems).toEqual([]);
    expect(r.maxPoint).toBe(3);
    expect(r.totalCount).toBe(8);
    expect(r.sheets.get(1)).toEqual([[5, 10], [8, 20], [12, 30], [50, 35]]);
    expect(r.sheets.get(2)).toEqual([[7, 10], [9, 20]]);
    expect(r.sheets.get(3)).toEqual([[0, 5], [3, 12]]);
  });

  it('BOM 付き UTF-8、CRLF、指定の列順、日時は "YYYY-MM-DD HH:mm:ss"', async () => {
    const project = await buildProject([[[5, 10]]]);
    const csv = buildExcelCsv(await repo.getProjectSnapshot(project.id));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('RecordID,PointID,ProjectNumber,PointName,PointNumber,Sequence,BlowCount,PenetrationCm,CumulativeDepthCm,RecordedAt');
    expect(lines[1]).toMatch(/^[0-9a-f-]{36},[0-9a-f-]{36},0540,K-1,1,1,5,10,10,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(lines[2]).toBe(''); // 末尾は改行で終わる
  });

  it('業務番号にカンマや引用符があっても取込できる', async () => {
    const project = await buildProject([[[5, 10]]], '0540,"A"');
    const r = vbaValidateCsv(buildExcelCsv(await repo.getProjectSnapshot(project.id)));
    expect(r.ok).toBe(true);
    expect(csvField('a,"b"')).toBe('"a,""b"""');
  });

  it('途中の地点に記録がないと出力前に止め、そのまま出せばマクロも拒否する', async () => {
    const project = await buildProject([[[5, 10]], [[6, 10]], [[7, 10]]]);
    const points = await repo.listPointSummaries(project.id);
    await repo.renumberPoint(points[1].id, 5); // K-2 → K-5（K-2 が欠番になる）
    const snapshot = await repo.getProjectSnapshot(project.id);
    const readiness = checkCsvReadiness(snapshot);
    expect(readiness.errors.join()).toContain('K-2');
    expect(vbaValidateCsv(buildExcelCsv(snapshot)).ok).toBe(false);
  });

  it('測定中・測定なしの最後の地点は注記だけで出力できる', async () => {
    const project = await buildProject([[[5, 10]], []]); // K-2 は開始しただけ
    const snapshot = await repo.getProjectSnapshot(project.id);
    const readiness = checkCsvReadiness(snapshot);
    expect(readiness.errors).toEqual([]);
    expect(readiness.notes.join()).toContain('K-2 は測定がない');
    expect(vbaValidateCsv(buildExcelCsv(snapshot)).ok).toBe(true);
  });

  it('測定がなければエラー', async () => {
    const project = await buildProject([]);
    expect(checkCsvReadiness(await repo.getProjectSnapshot(project.id)).errors).toEqual(['測定データがありません。']);
  });
});
