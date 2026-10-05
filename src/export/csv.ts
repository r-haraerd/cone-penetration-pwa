import { pointNameOf, type ProjectSnapshot } from '../domain/types';

/**
 * Excel 取込用 CSV（0540_簡易貫入試験_現場データ取込.xlsm の「現場データ取込」ボタン用）。
 *
 * 取込マクロ FieldDataImport.bas の仕様に合わせている：
 * - 必須列 RecordID, PointID, PointName, PointNumber, Sequence, BlowCount,
 *   PenetrationCm, CumulativeDepthCm, RecordedAt（列順は任意、追加列 ProjectNumber は無視される）
 * - UTF-8。先頭の BOM はマクロが除去する（BOM 付きにしておくと Excel で直接開いても文字化けしない）
 * - 1 ファイル = 1 案件の全地点・全測定
 * 列を変更するときは取込マクロと tests/helpers/fieldDataImportRules.ts も確認すること。
 */
export const CSV_COLUMNS = [
  'RecordID',
  'PointID',
  'ProjectNumber',
  'PointName',
  'PointNumber',
  'Sequence',
  'BlowCount',
  'PenetrationCm',
  'CumulativeDepthCm',
  'RecordedAt',
] as const;

const BOM = '﻿';
const NEWLINE = '\r\n';

export function buildExcelCsv(snapshot: ProjectSnapshot): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const { point, measurements } of snapshot.points) {
    for (const m of measurements) {
      lines.push([
        m.id,
        point.id,
        snapshot.project.projectNumber,
        pointNameOf(point.pointNumber),
        point.pointNumber,
        m.sequence,
        m.blowCount,
        m.penetrationCm,
        m.cumulativeDepthCm,
        formatLocalDateTime(m.recordedAt),
      ].map(csvField).join(','));
    }
  }
  return BOM + lines.join(NEWLINE) + NEWLINE;
}

/** カンマ・引用符・改行を含む値だけ引用符で囲む */
export function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 端末のローカル時刻で "2026-09-30 09:10:00"（既存サンプル CSV と同じ形式） */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface CsvReadiness {
  /** 取込マクロが拒否する問題。1 つでもあれば CSV を出力しない */
  errors: string[];
  /** 取込はできるが知っておくべきこと */
  notes: string[];
  measurementCount: number;
}

/** 取込マクロの検証に通るかを出力前に確認する */
export function checkCsvReadiness(snapshot: ProjectSnapshot): CsvReadiness {
  const errors: string[] = [];
  const notes: string[] = [];
  const withData = snapshot.points.filter((p) => p.measurements.length > 0);
  const measurementCount = withData.reduce((sum, p) => sum + p.measurements.length, 0);
  if (measurementCount === 0) {
    errors.push('測定データがありません。');
    return { errors, notes, measurementCount };
  }
  const maxWithData = Math.max(...withData.map((p) => p.point.pointNumber));
  const byNumber = new Map(snapshot.points.map((p) => [p.point.pointNumber, p]));
  const missing: string[] = [];
  for (let n = 1; n <= maxWithData; n++) {
    if (!byNumber.get(n)?.measurements.length) missing.push(pointNameOf(n));
  }
  if (missing.length > 0) {
    errors.push(
      `${missing.join('、')} の記録がありません。Excel 取込には K-1 から最後に記録した地点まで、` +
      'すべての地点の記録が必要です。未測定の地点を測定するか、地点の設定で番号を入れ替えてください。',
    );
  }
  for (const { point, measurements } of snapshot.points) {
    if (measurements.length === 0 && point.pointNumber > maxWithData) {
      notes.push(`${pointNameOf(point.pointNumber)} は未測定のため出力されません。`);
    } else if (measurements.length > 0 && point.status === 'active') {
      notes.push(`${pointNameOf(point.pointNumber)} は終了していません（ここまでの記録を出力します）。`);
    }
  }
  return { errors, notes, measurementCount };
}
