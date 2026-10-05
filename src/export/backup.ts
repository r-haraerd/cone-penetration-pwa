import {
  MAX_MEASUREMENTS_PER_POINT,
  MAX_POINTS,
  SCHEMA_VERSION,
  pointNameOf,
  type Measurement,
  type Point,
  type PointStatus,
  type ProjectSnapshot,
} from '../domain/types';

/**
 * JSON バックアップ（案件 1 件を丸ごと保存・復元する形式）。
 *
 * - schemaVersion で形式を識別する。形式を変えるときは SCHEMA_VERSION を上げ、
 *   migrateToCurrent() に旧形式からの変換を追加して、旧バックアップも読めるようにする。
 * - 地点・測定は入れ子で持ち、projectId / pointId は構造から復元する（ファイル内の不整合を防ぐ）。
 * - pointName は人が読むための参考値。復元時は pointNumber から作り直す。
 */
export const BACKUP_APP_ID = 'cone-penetration-pwa';

export interface BackupMeasurementV1 {
  id: string;
  sequence: number;
  blowCount: number;
  penetrationCm: number;
  cumulativeDepthCm: number;
  recordedAt: string;
  updatedAt: string;
}

export interface BackupPointV1 {
  id: string;
  pointNumber: number;
  pointName: string;
  status: PointStatus;
  createdAt: string;
  finishedAt: string | null;
  updatedAt: string;
  measurements: BackupMeasurementV1[];
}

export interface BackupFileV1 {
  schemaVersion: 1;
  app: typeof BACKUP_APP_ID;
  exportedAt: string;
  project: {
    id: string;
    projectNumber: string;
    projectName: string;
    createdAt: string;
    updatedAt: string;
    /** 電子納品情報（v0.8.0 以降。古いファイルにはない） */
    delivery?: { surveyTitle: string; clientName: string; contractorName: string; testerName: string };
  };
  points: BackupPointV1[];
}

export function buildBackup(snapshot: ProjectSnapshot, exportedAt: string): BackupFileV1 {
  const { project } = snapshot;
  return {
    schemaVersion: 1,
    app: BACKUP_APP_ID,
    exportedAt,
    project: {
      id: project.id,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ...(project.delivery ? { delivery: project.delivery } : {}),
    },
    points: snapshot.points.map(({ point, measurements }) => ({
      id: point.id,
      pointNumber: point.pointNumber,
      pointName: pointNameOf(point.pointNumber),
      status: point.status,
      createdAt: point.createdAt,
      finishedAt: point.finishedAt,
      updatedAt: point.updatedAt,
      measurements: measurements.map((m) => ({
        id: m.id,
        sequence: m.sequence,
        blowCount: m.blowCount,
        penetrationCm: m.penetrationCm,
        cumulativeDepthCm: m.cumulativeDepthCm,
        recordedAt: m.recordedAt,
        updatedAt: m.updatedAt,
      })),
    })),
  };
}

export function serializeBackup(backup: BackupFileV1): string {
  return JSON.stringify(backup, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// 読み込みと検証
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; snapshot: ProjectSnapshot; exportedAt: string }
  | { ok: false; errors: string[] };

const MAX_ERRORS = 15;
const ID_PATTERN = /^[0-9a-zA-Z-]{8,64}$/;

class Checker {
  errors: string[] = [];
  fail(message: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push(message);
  }
  isObject(value: unknown, where: string): value is Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
    this.fail(`${where} がありません、または形式が違います`);
    return false;
  }
  text(obj: Record<string, unknown>, key: string, where: string): string {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
    this.fail(`${where}.${key} は空でない文字列が必要です`);
    return '';
  }
  id(obj: Record<string, unknown>, key: string, where: string): string {
    const v = this.text(obj, key, where);
    if (v && !ID_PATTERN.test(v)) this.fail(`${where}.${key} の ID 形式が不正です`);
    return v;
  }
  dateTime(obj: Record<string, unknown>, key: string, where: string, nullable = false): string | null {
    const v = obj[key];
    if (nullable && (v === null || v === undefined)) return null;
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v;
    this.fail(`${where}.${key} は日時が必要です`);
    return '';
  }
  integer(obj: Record<string, unknown>, key: string, where: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const v = obj[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
    this.fail(`${where}.${key} は ${min} 以上${max === Number.MAX_SAFE_INTEGER ? '' : ` ${max} 以下`}の整数が必要です`);
    return 0;
  }
}

/** 電子納品情報（任意項目）。ない場合は何も返さない */
function parseDelivery(value: unknown, c: Checker): { delivery?: NonNullable<ProjectSnapshot['project']['delivery']> } {
  if (value === undefined || value === null) return {};
  if (!c.isObject(value, 'project.delivery')) return {};
  const text = (key: string) => {
    const v = value[key];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') {
      c.fail(`project.delivery.${key} は文字列が必要です`);
      return '';
    }
    return v;
  };
  return { delivery: { surveyTitle: text('surveyTitle'), clientName: text('clientName'), contractorName: text('contractorName'), testerName: text('testerName') } };
}

/** 旧形式のバックアップを現在の形式に変換する。今は v1 のみ */
function migrateToCurrent(raw: Record<string, unknown>, c: Checker): Record<string, unknown> | null {
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    c.fail('schemaVersion がありません。このアプリのバックアップファイルではない可能性があります');
    return null;
  }
  if (version > SCHEMA_VERSION) {
    c.fail(`新しいバージョンのアプリで作られたバックアップです（schemaVersion ${version}）。アプリを更新してください`);
    return null;
  }
  if (version !== 1) {
    c.fail(`対応していない schemaVersion です：${version}`);
    return null;
  }
  return raw;
}

/**
 * JSON テキストを検証して ProjectSnapshot にする。
 * 1 か所でも問題があれば ok:false を返し、呼び出し側は何も書き込まない。
 */
export function parseBackup(text: string): ParseResult {
  const c = new Checker();
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, errors: ['JSON として読み込めません。ファイルが壊れているか、別の種類のファイルです'] };
  }
  if (!c.isObject(raw, 'ファイル')) return { ok: false, errors: c.errors };
  const data = migrateToCurrent(raw, c);
  if (!data) return { ok: false, errors: c.errors };
  if (data.app !== undefined && data.app !== BACKUP_APP_ID) c.fail('このアプリのバックアップファイルではありません');

  const exportedAt = c.dateTime(data, 'exportedAt', 'ファイル') ?? '';
  if (!c.isObject(data.project, 'project')) return { ok: false, errors: c.errors };
  const p = data.project;
  const project = {
    id: c.id(p, 'id', 'project'),
    projectNumber: c.text(p, 'projectNumber', 'project').trim(),
    projectName: c.text(p, 'projectName', 'project').trim(),
    createdAt: c.dateTime(p, 'createdAt', 'project') ?? '',
    updatedAt: c.dateTime(p, 'updatedAt', 'project') ?? '',
    lastBackupAt: exportedAt || null,
    ...parseDelivery(p.delivery, c),
  };

  if (!Array.isArray(data.points)) {
    c.fail('points は配列が必要です');
    return { ok: false, errors: c.errors };
  }
  if (data.points.length > MAX_POINTS) c.fail(`地点は最大 ${MAX_POINTS} 地点です（${data.points.length} 地点あります）`);

  const seenIds = new Set<string>([project.id]);
  const seenNumbers = new Set<number>();
  const checkUnique = (id: string, where: string) => {
    if (!id) return;
    if (seenIds.has(id)) c.fail(`${where} の ID が重複しています`);
    seenIds.add(id);
  };
  const points: ProjectSnapshot['points'] = [];

  data.points.forEach((rawPoint: unknown, i: number) => {
    const where = `points[${i}]`;
    if (!c.isObject(rawPoint, where)) return;
    const pointNumber = c.integer(rawPoint, 'pointNumber', where, 1, MAX_POINTS);
    const name = pointNumber ? pointNameOf(pointNumber) : where;
    if (pointNumber && seenNumbers.has(pointNumber)) c.fail(`${name} が重複しています`);
    seenNumbers.add(pointNumber);
    const status = rawPoint.status;
    if (status !== 'active' && status !== 'finished') c.fail(`${name} の status が不正です`);
    const point: Point = {
      id: c.id(rawPoint, 'id', name),
      projectId: project.id,
      pointNumber,
      status: status === 'active' ? 'active' : 'finished',
      createdAt: c.dateTime(rawPoint, 'createdAt', name) ?? '',
      finishedAt: c.dateTime(rawPoint, 'finishedAt', name, true),
      updatedAt: c.dateTime(rawPoint, 'updatedAt', name) ?? '',
    };
    checkUnique(point.id, name);

    const rawMeasurements = rawPoint.measurements;
    if (!Array.isArray(rawMeasurements)) {
      c.fail(`${name} の measurements は配列が必要です`);
      return;
    }
    if (rawMeasurements.length > MAX_MEASUREMENTS_PER_POINT) c.fail(`${name} の測定が ${MAX_MEASUREMENTS_PER_POINT} 件を超えています`);
    const measurements: Measurement[] = [];
    rawMeasurements.forEach((rawM: unknown, j: number) => {
      const mWhere = `${name} measurements[${j}]`;
      if (!c.isObject(rawM, mWhere)) return;
      const m: Measurement = {
        id: c.id(rawM, 'id', mWhere),
        projectId: project.id,
        pointId: point.id,
        sequence: c.integer(rawM, 'sequence', mWhere, 1, MAX_MEASUREMENTS_PER_POINT),
        blowCount: c.integer(rawM, 'blowCount', mWhere, 0),
        penetrationCm: c.integer(rawM, 'penetrationCm', mWhere, 1),
        cumulativeDepthCm: c.integer(rawM, 'cumulativeDepthCm', mWhere, 1),
        recordedAt: c.dateTime(rawM, 'recordedAt', mWhere) ?? '',
        updatedAt: c.dateTime(rawM, 'updatedAt', mWhere) ?? '',
      };
      checkUnique(m.id, mWhere);
      measurements.push(m);
    });
    // 測定順が 1 から連番で、累積深度が貫入量の累計と一致すること
    measurements.sort((a, b) => a.sequence - b.sequence);
    let depth = 0;
    measurements.forEach((m, k) => {
      if (m.sequence !== k + 1) c.fail(`${name} の測定順 No.${k + 1} が欠けているか重複しています`);
      depth += m.penetrationCm;
      if (m.cumulativeDepthCm !== depth) c.fail(`${name} No.${m.sequence} の累積深度が貫入量の合計と一致しません`);
    });
    points.push({ point, measurements });
  });

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  points.sort((a, b) => a.point.pointNumber - b.point.pointNumber);
  return { ok: true, exportedAt, snapshot: { project, points } };
}
