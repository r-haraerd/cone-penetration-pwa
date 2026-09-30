import Dexie, { type EntityTable } from 'dexie';
import type { Measurement, Point, Project } from '../domain/types';

/**
 * IndexedDB のスキーマ。
 * - `&[projectId+pointNumber]` で同一案件内の地点番号の重複を DB レベルで防ぐ。
 * - `[pointId+sequence]` は測定順での取得用。再計算中に一時的に番号が重なる可能性が
 *   あるため一意制約にはせず、連番の保証は recalculatePoint が担う。
 * スキーマを変更するときは version(2) を追加し、既存データの移行を upgrade() に書く。
 */
export class FieldDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  points!: EntityTable<Point, 'id'>;
  measurements!: EntityTable<Measurement, 'id'>;

  constructor(name = 'cone-penetration-field') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      points: 'id, projectId, &[projectId+pointNumber]',
      measurements: 'id, projectId, pointId, [pointId+sequence]',
    });
  }
}

export const db = new FieldDatabase();

/** 端末の空き容量不足などでブラウザがデータを消さないよう永続化を要求する */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // 対応していないブラウザでは何もしない
  }
  return false;
}
