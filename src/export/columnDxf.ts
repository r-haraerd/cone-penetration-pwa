import { pointNameOf, type Measurement, type Point } from '../domain/types';
import { ndOf } from './jgsXml';

/**
 * 簡易貫入柱状図（DXF）。
 *
 * 学習用データの簡易貫入柱状図（DWG）を解析し、同じ配置・寸法・画層で描く。
 * DWG は AutoCAD 独自の非公開形式でブラウザから書き出せないため、交換形式の DXF で出力する
 * （AutoCAD・Jw_cad 等でそのまま開ける。AutoCAD なら「名前を付けて保存」で DWG にできる）。
 * 日本語を含むため AutoCAD R12 形式・Shift_JIS（$DWGCODEPAGE ANSI_932）で出力する。
 *
 * 図面の決まり（単位は図面単位。地点ごとに横へ 200 ずらす）
 * - 地表面 y = 125。深度 1 m = 20（貫入深さ cm × 0.2）
 * - 柱状図の枠 x = 46.5〜76.5（幅 30）。Nd 0〜50 を 10 ごとに縦線と目盛（Nd 1 = 0.6、0.25 単位で切り捨て）
 * - 測定点：半径 1 の円＋塗りつぶし。点どうしを線で結ぶ。Nd が 50 を超える点は枠の右端で線を切り、
 *   最終点なら底辺に「→」の印を付ける（円は描かない）
 * - 深度目盛：0.5 m ごとに枠内へ横線を引き、枠の左に深度（0.5・1.0 …）を書く（最終深度まで）。
 *   学習用データ「簡易貫入柱状図_深度スケール入り.dwg」にならったもの
 * - 引出線と 15° 傾けた文字（地点名・T.P.m・dep = 最終深度）
 * - 画層：S-TTL（図枠）、S-TTL-GRD（距離・標高目盛）、S-BGD-BNDR（下端線）、S-BGD-BRG（柱状図）
 */

export interface ColumnData {
  point: Point;
  measurements: Measurement[];
}

const GROUND_Y = 125;
const COLUMN_PITCH = 200;
const FRAME_LEFT = 46.5;
const FRAME_RIGHT = 76.5;
const ND_STEP_X = 6; // Nd 10 ごと
const DEPTH_STEP_CM = 50; // 深度目盛 0.5 m ごと

/** Nd → 枠左端からの横位置（0.6 倍を 0.25 単位で切り捨て）。整数演算で誤差を出さない */
export function ndToX(nd: number): number {
  return Math.floor((nd * 12) / 5) / 4;
}

const r = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s === '-0' ? '0' : s;
};

class DxfWriter {
  private out: string[] = [];
  private extMin = [Infinity, Infinity];
  private extMax = [-Infinity, -Infinity];

  pair(code: number, value: string | number): void {
    this.out.push(String(code), typeof value === 'number' ? r(value) : value);
  }

  private grow(x: number, y: number): void {
    this.extMin = [Math.min(this.extMin[0], x), Math.min(this.extMin[1], y)];
    this.extMax = [Math.max(this.extMax[0], x), Math.max(this.extMax[1], y)];
  }

  /** 線（幅つきポリライン。width=0 なら通常の線） */
  polyline(layer: string, pts: Array<[number, number]>, width = 0, closed = false): void {
    this.pair(0, 'POLYLINE');
    this.pair(8, layer);
    this.pair(66, 1);
    this.pair(10, 0); this.pair(20, 0); this.pair(30, 0);
    this.pair(70, closed ? 1 : 0);
    if (width) { this.pair(40, width); this.pair(41, width); }
    for (const [x, y] of pts) {
      this.pair(0, 'VERTEX');
      this.pair(8, layer);
      this.pair(10, x); this.pair(20, y); this.pair(30, 0);
      this.grow(x, y);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, layer);
  }

  circle(layer: string, x: number, y: number, radius: number): void {
    this.pair(0, 'CIRCLE');
    this.pair(8, layer);
    this.pair(10, x); this.pair(20, y); this.pair(30, 0);
    this.pair(40, radius);
    this.grow(x - radius, y - radius);
    this.grow(x + radius, y + radius);
  }

  /** 塗りつぶした円（ドーナツ：幅 = 半径 の閉じた円弧ポリライン） */
  disk(layer: string, x: number, y: number, radius: number): void {
    const half = radius / 2;
    this.pair(0, 'POLYLINE');
    this.pair(8, layer);
    this.pair(66, 1);
    this.pair(10, 0); this.pair(20, 0); this.pair(30, 0);
    this.pair(70, 1);
    this.pair(40, radius); this.pair(41, radius);
    for (const vx of [x - half, x + half]) {
      this.pair(0, 'VERTEX');
      this.pair(8, layer);
      this.pair(10, vx); this.pair(20, y); this.pair(30, 0);
      this.pair(42, 1);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, layer);
  }

  /**
   * 文字。halign 0=左 1=中央 2=右、valign 0=基準線 2=中央 3=上。
   * 揃え位置（x, y）を基準に置く（AutoCAD が文字幅から開始位置を計算する）。
   */
  text(layer: string, x: number, y: number, height: number, value: string,
    opts: { rotation?: number; halign?: number; valign?: number; widthFactor?: number } = {}): void {
    const { rotation = 0, halign = 0, valign = 0, widthFactor = 1 } = opts;
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.pair(10, x); this.pair(20, y); this.pair(30, 0);
    this.pair(40, height);
    this.pair(1, value);
    if (rotation) this.pair(50, rotation);
    if (widthFactor !== 1) this.pair(41, widthFactor);
    this.pair(7, 'STANDARD');
    if (halign) this.pair(72, halign);
    if (halign || valign) { this.pair(11, x); this.pair(21, y); this.pair(31, 0); }
    if (valign) this.pair(73, valign);
    this.grow(x, y);
  }

  build(layers: string[]): string {
    const head: string[] = [];
    const p = (c: number, v: string | number) => head.push(String(c), typeof v === 'number' ? r(v) : v);
    p(0, 'SECTION'); p(2, 'HEADER');
    p(9, '$ACADVER'); p(1, 'AC1009');
    p(9, '$DWGCODEPAGE'); p(3, 'ANSI_932');
    p(9, '$INSBASE'); p(10, 0); p(20, 0); p(30, 0);
    p(9, '$EXTMIN'); p(10, this.extMin[0]); p(20, this.extMin[1]); p(30, 0);
    p(9, '$EXTMAX'); p(10, this.extMax[0]); p(20, this.extMax[1]); p(30, 0);
    p(9, '$LIMMIN'); p(10, this.extMin[0]); p(20, this.extMin[1]);
    p(9, '$LIMMAX'); p(10, this.extMax[0]); p(20, this.extMax[1]);
    p(0, 'ENDSEC');
    p(0, 'SECTION'); p(2, 'TABLES');
    p(0, 'TABLE'); p(2, 'LTYPE'); p(70, 1);
    p(0, 'LTYPE'); p(2, 'CONTINUOUS'); p(70, 0); p(3, 'Solid line'); p(72, 65); p(73, 0); p(40, 0);
    p(0, 'ENDTAB');
    p(0, 'TABLE'); p(2, 'LAYER'); p(70, layers.length + 1);
    for (const name of ['0', ...layers]) {
      p(0, 'LAYER'); p(2, name); p(70, 0); p(62, 7); p(6, 'CONTINUOUS');
    }
    p(0, 'ENDTAB');
    p(0, 'TABLE'); p(2, 'STYLE'); p(70, 1);
    p(0, 'STYLE'); p(2, 'STANDARD'); p(70, 0); p(40, 0); p(41, 1); p(50, 0); p(71, 0); p(42, 2.5);
    p(3, 'monotxt.shx'); p(4, 'extfont2.shx');
    p(0, 'ENDTAB');
    p(0, 'ENDSEC');
    p(0, 'SECTION'); p(2, 'ENTITIES');
    const tail = ['0', 'ENDSEC', '0', 'EOF'];
    return [...head, ...this.out, ...tail].join('\r\n') + '\r\n';
  }
}

const L = { frame: 'S-TTL', grid: 'S-TTL-GRD', boundary: 'S-BGD-BNDR', column: 'S-BGD-BRG' } as const;

/** 1 地点分の柱状図（ox = 横方向のずらし量） */
function drawColumn(w: DxfWriter, ox: number, { point, measurements }: ColumnData): void {
  const last = measurements[measurements.length - 1];
  const bottom = GROUND_Y - last.cumulativeDepthCm / 5;
  const x0 = ox + FRAME_LEFT;
  const x1 = ox + FRAME_RIGHT;
  const rad15 = (15 * Math.PI) / 180;
  const cl = L.column;

  // 引出線と見出し（15° 傾け）
  w.polyline(cl, [[x0, GROUND_Y], [x0, GROUND_Y + 20]]);
  w.polyline(cl, [[x0, GROUND_Y + 20], [x0 + 20 * Math.cos(rad15), GROUND_Y + 20 + 20 * Math.sin(rad15)]]);
  w.text(cl, x0, 149, 2.8, pointNameOf(point.pointNumber), { rotation: 15, valign: 3 });
  w.text(cl, x0 + 1, 144.25, 2.1, 'T.P.m', { rotation: 15, valign: 3 });
  w.text(cl, x0 + 2, 141.25, 2.1, `dep = ${(last.cumulativeDepthCm / 100).toFixed(3)} m`, { rotation: 15, valign: 3 });

  // 枠（線幅 0.13）
  w.polyline(cl, [[x0, GROUND_Y], [x1, GROUND_Y]], 0.13);
  w.polyline(cl, [[x1, GROUND_Y], [x1, bottom]], 0.13);
  w.polyline(cl, [[x1, bottom], [x0, bottom]], 0.13);
  w.polyline(cl, [[x0, bottom], [x0, GROUND_Y]], 0.13);

  // Nd 目盛
  w.text(cl, ox + 62.44419312978357, 129, 1.75, 'Nd', { halign: 1, valign: 3 });
  for (let k = 0; k <= 5; k++) {
    const gx = x0 + ND_STEP_X * k;
    w.text(cl, gx + 0.94419312978357, 126.5, 1.05, String(k * 10), { halign: 1, valign: 3 });
    w.polyline(cl, [[gx, GROUND_Y], [gx, bottom]]);
  }

  // 深度目盛（0.5 m ごと。最終深度より深い目盛は描かない）
  for (let cm = DEPTH_STEP_CM; cm <= last.cumulativeDepthCm; cm += DEPTH_STEP_CM) {
    const gy = GROUND_Y - cm / 5;
    if (cm < last.cumulativeDepthCm) w.polyline(cl, [[x0, gy], [x1, gy]]);
    w.text(cl, x0 - 0.5, gy, 1.05, (cm / 100).toFixed(1), { halign: 2, valign: 2 });
  }

  // 測定点（地表 0 の点から）
  const pts = [{ x: x0, y: GROUND_Y, off: false }, ...measurements.map((m) => {
    const dx = ndToX(ndOf(m.blowCount, m.penetrationCm));
    return { x: x0 + dx, y: GROUND_Y - m.cumulativeDepthCm / 5, off: dx > FRAME_RIGHT - FRAME_LEFT };
  })];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const clip = (p: typeof a, q: typeof a): [number, number] => [x1, p.y + ((q.y - p.y) * (x1 - p.x)) / (q.x - p.x)];
    if (!a.off && !b.off) w.polyline(cl, [[a.x, a.y], [b.x, b.y]]);
    else if (!a.off && b.off) w.polyline(cl, [[a.x, a.y], clip(a, b)]);
    else if (a.off && !b.off) w.polyline(cl, [clip(b, a), [b.x, b.y]]);
    // 両方とも枠外なら線は描かない
  }
  const final = pts[pts.length - 1];
  if (final.off) {
    // 打ち止め（Nd が目盛を超える）の印
    w.polyline(cl, [[ox + 72.75, final.y], [x1, final.y]]);
    w.polyline(cl, [[x1, final.y], [ox + 76.25, final.y]]);
  }
  for (const p of pts) {
    if (p.off) continue;
    w.circle(cl, p.x, p.y, 1);
    w.disk(cl, p.x, p.y, 1);
  }
}

/** 全地点の柱状図を 1 枚の DXF（文字列）にする。保存時に Shift_JIS に変換する */
export function buildColumnSheetDxf(columns: ColumnData[]): string {
  const data = columns.filter((c) => c.measurements.length > 0);
  if (data.length === 0) throw new Error('記録のある地点がありません');
  const w = new DxfWriter();
  const right = COLUMN_PITCH * (data.length - 1) + 86.5;
  const maxDepthM = Math.max(...data.map((c) => c.measurements[c.measurements.length - 1].cumulativeDepthCm)) / 100;
  // 下端線は 5 m（y=25）。それより深い地点があれば 1 m 単位で下げる
  const base = Math.min(25, GROUND_Y - Math.ceil(maxDepthM) * 20);
  const shift = base - 25;

  // 図枠
  const top = 165;
  const bottom = shift;
  w.polyline(L.frame, [[0, top], [right + 20, top]]);
  w.polyline(L.frame, [[right + 20, top], [right + 20, bottom]]);
  w.polyline(L.frame, [[right + 20, bottom], [0, bottom]]);
  w.polyline(L.frame, [[0, bottom], [0, top]]);
  w.polyline(L.boundary, [[20, base], [right, base]]);

  // 標高目盛（左右）
  w.polyline(L.grid, [[18, GROUND_Y], [20, GROUND_Y]]);
  w.polyline(L.grid, [[right, GROUND_Y], [right + 2, GROUND_Y]]);
  w.text(L.grid, 17, 126.25, 1.75, '0.00', { halign: 2, valign: 3, widthFactor: 0.78 });
  w.text(L.grid, right + 3, 126.25, 1.75, '0.00', { valign: 3, widthFactor: 0.78 });
  w.text(L.grid, 20, 133, 2.34, '標高(m)', { halign: 1, valign: 3 });
  w.text(L.grid, right, 133, 2.34, '標高(m)', { halign: 1, valign: 3 });
  w.polyline(L.grid, [[20, GROUND_Y], [20, base]]);
  w.polyline(L.grid, [[right, GROUND_Y], [right, base]]);

  // 距離目盛（10 m ごと）
  const axisY = 20 + shift;
  const ticks = Math.floor((right - 40) / 100);
  for (let k = 0; k <= ticks; k++) {
    const x = 40 + 100 * k;
    w.polyline(L.grid, [[x, axisY], [x, axisY + 2]]);
    w.text(L.grid, x, axisY - 2, 1.75, (10 * k).toFixed(2), { halign: 1, valign: 3, widthFactor: 0.78 });
  }
  const lastTick = 40 + 100 * ticks;
  w.polyline(L.grid, [[40, axisY + 3], [40, axisY]]);
  w.polyline(L.grid, [[40, axisY], [lastTick, axisY]]);
  w.polyline(L.grid, [[lastTick, axisY], [lastTick, axisY + 3]]);
  w.text(L.grid, lastTick + 13.5, axisY - 2, 2.34, '距離(m)', { halign: 1, valign: 3 });

  data.forEach((c, i) => drawColumn(w, COLUMN_PITCH * i, c));
  return w.build([L.boundary, L.column, L.frame, L.grid]);
}
