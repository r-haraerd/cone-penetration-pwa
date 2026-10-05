// データモデルの型と業務上の定数。
// 深度・貫入量はすべて cm の整数で保持する（浮動小数点誤差を避けるため）。

export const SCHEMA_VERSION = 1;
export const MAX_POINTS = 25;
export const MAX_MEASUREMENTS_PER_POINT = 100;
export const DEFAULT_PENETRATION_CM = 10;
export const RECENT_MEASUREMENT_COUNT = 5;

/** active = 未終了（記録なしなら画面上は「未測定」）、finished = 終了 */
export type PointStatus = 'active' | 'finished';

/** ISO 8601 形式（UTC）の日時文字列 */
export type IsoDateTime = string;

export interface Project {
  id: string;
  projectNumber: string;
  projectName: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** 最後に JSON バックアップを保存した日時（未実施なら undefined/null） */
  lastBackupAt?: IsoDateTime | null;
  /** 電子納品 XML の見出しに使う情報（未入力なら undefined） */
  delivery?: {
    surveyTitle: string;
    clientName: string;
    contractorName: string;
    testerName: string;
  };
}

export interface Point {
  id: string;
  projectId: string;
  /** 1～25。地点名 K-n の n。Excel 取込は K-1 からの連番を要求する */
  pointNumber: number;
  status: PointStatus;
  createdAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
}

export interface Measurement {
  id: string;
  projectId: string;
  pointId: string;
  /** 地点内の測定順。1 から欠番なし */
  sequence: number;
  blowCount: number;
  penetrationCm: number;
  /** 地点内の貫入量の累計。penetrationCm から常に再計算される派生値 */
  cumulativeDepthCm: number;
  recordedAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 地点名は番号から常に導出する（Excel の地点名生成式・取込検証と一致させる） */
export function pointNameOf(pointNumber: number): string {
  return `K-${pointNumber}`;
}

/** 案件 1 件分の全データ（出力・バックアップ・復元の単位） */
export interface ProjectSnapshot {
  project: Project;
  /** 地点番号順。各地点の measurements は測定順 */
  points: Array<{ point: Point; measurements: Measurement[] }>;
}
