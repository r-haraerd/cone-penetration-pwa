import { recalculatePoint } from '../domain/depth';
import { newId, nowIso } from '../domain/ids';
import {
  MAX_MEASUREMENTS_PER_POINT,
  MAX_POINTS,
  RECENT_MEASUREMENT_COUNT,
  pointNameOf,
  type Measurement,
  type Point,
  type Project,
  type ProjectSnapshot,
} from '../domain/types';
import { isValidBlowCount, isValidPenetrationCm } from '../domain/validation';
import { db as defaultDb, type FieldDatabase } from './database';

/** 業務ルール違反。message はそのまま画面に表示できる日本語 */
export class DomainError extends Error {}

export interface ProjectSummary extends Project {
  /** 試験数量（K-1〜K-n の n） */
  pointCount: number;
  /** 記録が 1 件以上ある地点の数 */
  measuredPointCount: number;
}

export interface PointSummary extends Point {
  measurementCount: number;
  currentDepthCm: number;
}

export interface PointView {
  project: Project;
  point: Point;
  measurementCount: number;
  currentDepthCm: number;
  /** 新しい順 */
  recent: Measurement[];
}

export interface MeasurementView {
  project: Project;
  point: Point;
  measurement: Measurement;
  /** この記録の直前の累積深度 */
  previousDepthCm: number;
  /** この記録より後の測定件数 */
  followingCount: number;
}

/**
 * データ操作の唯一の窓口。画面から IndexedDB を直接触らない。
 * 書き込みはすべてトランザクション内で行い、途中で失敗しても半端な状態を残さない。
 */
export class Repository {
  constructor(private readonly db: FieldDatabase = defaultDb) {}

  // ---------- 案件 ----------

  async listProjectSummaries(): Promise<ProjectSummary[]> {
    return this.db.transaction('r', this.db.projects, this.db.points, this.db.measurements, async () => {
      const projects = await this.db.projects.orderBy('updatedAt').reverse().toArray();
      return Promise.all(
        projects.map(async (p) => {
          const points = await this.db.points.where('projectId').equals(p.id).toArray();
          const measuredPointIds = new Set(
            (await this.db.measurements.where('projectId').equals(p.id).toArray()).map((m) => m.pointId),
          );
          return { ...p, pointCount: points.length, measuredPointCount: points.filter((pt) => measuredPointIds.has(pt.id)).length };
        }),
      );
    });
  }

  /**
   * 案件を作成し、試験数量ぶんの地点 K-1〜K-n を用意する。
   * 地点は作成時点ですべて「未終了」で、どの地点からでも記録を始められる。
   */
  async createProject(projectNumber: string, projectName: string, pointCount: number): Promise<Project> {
    const number = projectNumber.trim();
    const name = projectName.trim();
    if (!number) throw new DomainError('業務番号を入力してください');
    if (!name) throw new DomainError('案件名を入力してください');
    assertPointCount(pointCount);
    const now = nowIso();
    const project: Project = { id: newId(), projectNumber: number, projectName: name, createdAt: now, updatedAt: now };
    await this.db.transaction('rw', this.db.projects, this.db.points, async () => {
      await this.db.projects.add(project);
      await this.db.points.bulkAdd(Array.from({ length: pointCount }, (_, i) => newPoint(project.id, i + 1, now)));
    });
    return project;
  }

  /**
   * 試験数量を変更する。増やすと末尾に地点を追加し、減らすと末尾の地点を削除する。
   * 削除される地点に記録が 1 件でもあれば減らせない（データを失わないため）。
   */
  async setPointCount(projectId: string, pointCount: number): Promise<void> {
    assertPointCount(pointCount);
    await this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      await this.getProject(projectId);
      const points = await this.db.points.where('projectId').equals(projectId).sortBy('pointNumber');
      const now = nowIso();
      if (pointCount > points.length) {
        const used = new Set(points.map((p) => p.pointNumber));
        const added: Point[] = [];
        for (let n = 1; added.length < pointCount - points.length; n++) {
          if (!used.has(n)) added.push(newPoint(projectId, n, now));
        }
        await this.db.points.bulkAdd(added);
      } else if (pointCount < points.length) {
        const removing = points.slice(pointCount);
        for (const p of removing) {
          if ((await this.db.measurements.where('pointId').equals(p.id).count()) > 0) {
            throw new DomainError(`${pointNameOf(p.pointNumber)} に記録があるため、試験数量を ${pointCount} に減らせません`);
          }
        }
        await this.db.points.bulkDelete(removing.map((p) => p.id));
      } else {
        return;
      }
      await this.touchProject(projectId, now);
    });
  }

  async getProject(projectId: string): Promise<Project> {
    const project = await this.db.projects.get(projectId);
    if (!project) throw new DomainError('案件が見つかりません');
    return project;
  }

  // ---------- 地点 ----------

  async listPointSummaries(projectId: string): Promise<PointSummary[]> {
    return this.db.transaction('r', this.db.points, this.db.measurements, async () => {
      const points = await this.db.points.where('projectId').equals(projectId).sortBy('pointNumber');
      return Promise.all(points.map(async (p) => ({ ...p, ...(await this.depthSummary(p.id)) })));
    });
  }

  async finishPoint(pointId: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      const point = await this.getPoint(pointId);
      if (point.status === 'finished') return;
      const count = await this.db.measurements.where('pointId').equals(pointId).count();
      if (count === 0) throw new DomainError('測定が 1 件もない地点は終了できません');
      const now = nowIso();
      await this.db.points.update(pointId, { status: 'finished', finishedAt: now, updatedAt: now });
      await this.touchProject(point.projectId, now);
    });
  }

  /** 終了した地点を再び記録できる状態に戻す */
  async reopenPoint(pointId: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.points, async () => {
      const point = await this.getPoint(pointId);
      if (point.status === 'active') return;
      const now = nowIso();
      await this.db.points.update(pointId, { status: 'active', finishedAt: null, updatedAt: now });
      await this.touchProject(point.projectId, now);
    });
  }

  async getPointView(pointId: string): Promise<PointView> {
    return this.db.transaction('r', this.db.projects, this.db.points, this.db.measurements, async () => {
      const point = await this.getPoint(pointId);
      const project = await this.getProject(point.projectId);
      const measurements = await this.measurementsOf(pointId);
      const last = measurements[measurements.length - 1];
      return {
        project,
        point,
        measurementCount: measurements.length,
        currentDepthCm: last ? last.cumulativeDepthCm : 0,
        recent: measurements.slice(-RECENT_MEASUREMENT_COUNT).reverse(),
      };
    });
  }

  // ---------- 測定 ----------

  /** 測定を末尾に追加し、IndexedDB に即時保存する */
  async addMeasurement(pointId: string, blowCount: number, penetrationCm: number): Promise<Measurement> {
    if (!isValidBlowCount(blowCount)) throw new DomainError('打撃回数は 0 以上の整数です');
    if (!isValidPenetrationCm(penetrationCm)) throw new DomainError('貫入量は 1 cm 以上の整数です');
    return this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      const point = await this.getPoint(pointId);
      if (point.status !== 'active') {
        throw new DomainError(`${pointNameOf(point.pointNumber)} は終了済みです`);
      }
      const existing = await this.measurementsOf(pointId);
      if (existing.length >= MAX_MEASUREMENTS_PER_POINT) {
        throw new DomainError(`1 地点の測定は最大 ${MAX_MEASUREMENTS_PER_POINT} 件です`);
      }
      const now = nowIso();
      const draft: Measurement = {
        id: newId(),
        projectId: point.projectId,
        pointId,
        sequence: existing.length + 1,
        blowCount,
        penetrationCm,
        cumulativeDepthCm: 0,
        recordedAt: now,
        updatedAt: now,
      };
      const { all, changed } = recalculatePoint([...existing, draft]);
      const saved = all[all.length - 1];
      // changed には新規分（累積深度 0 → 計算値）が必ず含まれる。
      // 既存データに不整合があった場合はその修復分も同時に保存される。
      await this.db.measurements.bulkPut(changed);
      await this.db.points.update(pointId, { updatedAt: now });
      await this.touchProject(point.projectId, now);
      return saved;
    });
  }

  async getMeasurementView(measurementId: string): Promise<MeasurementView> {
    return this.db.transaction('r', this.db.projects, this.db.points, this.db.measurements, async () => {
      const measurement = await this.db.measurements.get(measurementId);
      if (!measurement) throw new DomainError('測定記録が見つかりません（削除された可能性があります）');
      const point = await this.getPoint(measurement.pointId);
      const project = await this.getProject(point.projectId);
      const all = await this.measurementsOf(point.id);
      return { project, point, measurement, previousDepthCm: measurement.cumulativeDepthCm - measurement.penetrationCm, followingCount: all.length - measurement.sequence };
    });
  }

  async listMeasurements(pointId: string): Promise<Measurement[]> {
    return this.db.transaction('r', this.db.measurements, () => this.measurementsOf(pointId));
  }

  /**
   * 測定記録の打撃回数・貫入量を修正する。終了済みの地点でも修正できる。
   * 貫入量が変わった場合、その記録以降の累積深度を同じトランザクション内で再計算する。
   */
  async updateMeasurement(measurementId: string, blowCount: number, penetrationCm: number): Promise<Measurement> {
    if (!isValidBlowCount(blowCount)) throw new DomainError('打撃回数は 0 以上の整数です');
    if (!isValidPenetrationCm(penetrationCm)) throw new DomainError('貫入量は 1 cm 以上の整数です');
    return this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      const target = await this.db.measurements.get(measurementId);
      if (!target) throw new DomainError('測定記録が見つかりません（削除された可能性があります）');
      const now = nowIso();
      const edited: Measurement = { ...target, blowCount, penetrationCm, updatedAt: now };
      const existing = await this.measurementsOf(target.pointId);
      const { all, changed } = recalculatePoint(existing.map((m) => (m.id === measurementId ? edited : m)));
      const toSave = new Map<string, Measurement>();
      for (const m of changed) toSave.set(m.id, { ...m, updatedAt: now });
      if (!toSave.has(measurementId)) toSave.set(measurementId, edited);
      await this.db.measurements.bulkPut([...toSave.values()]);
      await this.touchPointAndProject(target.pointId, target.projectId, now);
      return all.find((m) => m.id === measurementId)!;
    });
  }

  /** 測定記録を削除し、以降の測定順と累積深度を振り直す */
  async deleteMeasurement(measurementId: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      const target = await this.db.measurements.get(measurementId);
      if (!target) return; // 既に削除済み
      await this.db.measurements.delete(measurementId);
      const now = nowIso();
      const remaining = await this.measurementsOf(target.pointId);
      const { changed } = recalculatePoint(remaining);
      await this.db.measurements.bulkPut(changed.map((m) => ({ ...m, updatedAt: now })));
      await this.touchPointAndProject(target.pointId, target.projectId, now);
    });
  }

  // ---------- 地点の番号入れ替え・記録の全削除 ----------

  /**
   * 地点の番号を変更する（例：K-4 に記録すべきものを K-3 に記録してしまった場合）。
   * 変更先の番号を別の地点が使っていれば、2 つの地点の番号を入れ替える（記録ごと入れ替わる）。
   */
  async movePoint(pointId: string, targetNumber: number): Promise<{ swappedWith: number | null }> {
    return this.db.transaction('rw', this.db.projects, this.db.points, async () => {
      const point = await this.getPoint(pointId);
      const points = await this.db.points.where('projectId').equals(point.projectId).toArray();
      const maxNumber = Math.max(...points.map((p) => p.pointNumber));
      if (!Number.isInteger(targetNumber) || targetNumber < 1 || targetNumber > maxNumber) {
        throw new DomainError(`地点番号は 1～${maxNumber} の整数です`);
      }
      if (point.pointNumber === targetNumber) return { swappedWith: null };
      const other = points.find((p) => p.pointNumber === targetNumber);
      const now = nowIso();
      if (other) {
        // [projectId+pointNumber] は一意なので、いったん 0 に退避してから入れ替える
        await this.db.points.update(point.id, { pointNumber: 0 });
        await this.db.points.update(other.id, { pointNumber: point.pointNumber, updatedAt: now });
      }
      await this.db.points.update(point.id, { pointNumber: targetNumber, updatedAt: now });
      await this.touchProject(point.projectId, now);
      return { swappedWith: other ? point.pointNumber : null };
    });
  }

  /** 地点の記録をすべて削除し、未測定の状態に戻す（地点そのものは残る） */
  async clearPoint(pointId: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      const point = await this.getPoint(pointId);
      const now = nowIso();
      await this.db.measurements.where('pointId').equals(pointId).delete();
      await this.db.points.update(pointId, { status: 'active', finishedAt: null, updatedAt: now });
      await this.touchProject(point.projectId, now);
    });
  }

  // ---------- 案件全体（出力・バックアップ・復元・削除） ----------

  async getProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
    return this.db.transaction('r', this.db.projects, this.db.points, this.db.measurements, async () => {
      const project = await this.getProject(projectId);
      const points = await this.db.points.where('projectId').equals(projectId).sortBy('pointNumber');
      return {
        project,
        points: await Promise.all(points.map(async (point) => ({ point, measurements: await this.measurementsOf(point.id) }))),
      };
    });
  }

  async projectExists(projectId: string): Promise<boolean> {
    return (await this.db.projects.get(projectId)) !== undefined;
  }

  /**
   * 検証済みのスナップショットを 1 トランザクションで書き込む。
   * replace=true なら同じ ID の案件を丸ごと置き換える。途中で失敗したら何も変わらない。
   */
  async importSnapshot(snapshot: ProjectSnapshot, replace: boolean): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      const projectId = snapshot.project.id;
      const exists = await this.db.projects.get(projectId);
      if (exists && !replace) throw new DomainError('同じ案件が既にこの端末にあります');
      // 他の案件のデータと ID が衝突していないか（通常は起こらない）
      const pointIds = snapshot.points.map((p) => p.point.id);
      const measurementIds = snapshot.points.flatMap((p) => p.measurements.map((m) => m.id));
      const clashPoint = (await this.db.points.bulkGet(pointIds)).find((p) => p && p.projectId !== projectId);
      const clashMeasurement = (await this.db.measurements.bulkGet(measurementIds)).find((m) => m && m.projectId !== projectId);
      if (clashPoint || clashMeasurement) throw new DomainError('別の案件と ID が重複しているため復元できません');
      if (exists) {
        await this.db.measurements.where('projectId').equals(projectId).delete();
        await this.db.points.where('projectId').equals(projectId).delete();
      }
      await this.db.projects.put(snapshot.project);
      await this.db.points.bulkPut(snapshot.points.map((p) => p.point));
      await this.db.measurements.bulkPut(snapshot.points.flatMap((p) => p.measurements));
    });
  }

  /** JSON バックアップを保存した日時を記録する（更新日時は変えない） */
  async markBackedUp(projectId: string, at: string = nowIso()): Promise<void> {
    await this.db.projects.update(projectId, { lastBackupAt: at });
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.points, this.db.measurements, async () => {
      await this.db.measurements.where('projectId').equals(projectId).delete();
      await this.db.points.where('projectId').equals(projectId).delete();
      await this.db.projects.delete(projectId);
    });
  }

  // ---------- 内部 ----------

  private async touchPointAndProject(pointId: string, projectId: string, now: string): Promise<void> {
    await this.db.points.update(pointId, { updatedAt: now });
    await this.touchProject(projectId, now);
  }

  private async getPoint(pointId: string): Promise<Point> {
    const point = await this.db.points.get(pointId);
    if (!point) throw new DomainError('地点が見つかりません');
    return point;
  }

  /** 測定順に並んだ地点内の測定 */
  private measurementsOf(pointId: string): Promise<Measurement[]> {
    return this.db.measurements.where('[pointId+sequence]').between([pointId, -Infinity], [pointId, Infinity]).toArray();
  }

  private async depthSummary(pointId: string): Promise<{ measurementCount: number; currentDepthCm: number }> {
    const measurements = await this.measurementsOf(pointId);
    const last = measurements[measurements.length - 1];
    return { measurementCount: measurements.length, currentDepthCm: last ? last.cumulativeDepthCm : 0 };
  }

  private async touchProject(projectId: string, now: string): Promise<void> {
    await this.db.projects.update(projectId, { updatedAt: now });
  }
}

function assertPointCount(pointCount: number): void {
  if (!Number.isInteger(pointCount) || pointCount < 1 || pointCount > MAX_POINTS) {
    throw new DomainError(`試験数量は 1～${MAX_POINTS} の整数で入力してください`);
  }
}

function newPoint(projectId: string, pointNumber: number, now: string): Point {
  return { id: newId(), projectId, pointNumber, status: 'active', createdAt: now, finishedAt: null, updatedAt: now };
}

export const repository = new Repository();
