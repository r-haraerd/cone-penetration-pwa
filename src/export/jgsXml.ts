import { pointNameOf, type Measurement, type Point } from '../domain/types';

/**
 * 電子納品「簡易動的コーン貫入試験データシート交換用データ」（JGS 1433、DTD B1433_03）。
 * 地点ごとに 1 ファイル（K-1.XML など）。文字コードは Shift_JIS、改行は CRLF。
 *
 * 形式は、学習用データ（実案件の電子納品 XML 19 地点。テストでは見出しを匿名化して使用）を解析して合わせている。
 * tests/jgsXml.test.ts で、同じ測定値から元ファイルとバイト単位で同じものができることを確認している。
 *
 * 決まり
 * - 測定の先頭に「打撃回数 0・貫入深さ 0」の行を置く（貫入量・Nd なし）
 * - 貫入深さ・貫入量は cm、Nd = 10 × 打撃回数 ÷ 貫入量 を四捨五入
 * - グラフ（深度-Nd）の XY 値は「Nd,深度(m)」。深度は cm × 0.01 を小数 2 桁で表し、
 *   計算誤差が出る値だけ 3 桁になる（元データを作ったソフトと同じ表し方）
 * - Nd 軸 0〜50（10 刻み）、深度軸 0〜（最終深度を 0.5 m 単位で切り上げ、最小 1 m）
 */

export interface DeliveryInfo {
  /** 調査件名 */
  surveyTitle: string;
  /** 発注機関名称 */
  clientName: string;
  /** 調査業者名 */
  contractorName: string;
  /** 試験者 */
  testerName: string;
}

const CRLF = '\r\n';

/** Nd = 10 × 打撃回数 ÷ 貫入量（四捨五入） */
export function ndOf(blowCount: number, penetrationCm: number): number {
  return Math.floor((10 * blowCount) / penetrationCm + 0.5);
}

/** 深度（cm）→ XY 値の深度表記（元データと同じく cm × 0.01 の計算誤差で桁数が変わる） */
export function xyDepth(depthCm: number): string {
  const m = depthCm * 0.01;
  const two = m.toFixed(2);
  return Number(two) === m ? two : m.toFixed(3);
}

/** 深度軸の最大値（m）：最終深度を 0.5 m 単位で切り上げ、最小 1 m */
export function depthAxisMax(lastDepthCm: number): string {
  const halfMeters = Math.ceil(lastDepthCm / 50);
  return String(Math.max(1, halfMeters / 2));
}

/** 端末のローカル日付 "2026-10-02" */
function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function jgsXmlFileName(point: Point): string {
  return `${pointNameOf(point.pointNumber)}.XML`;
}

/** 1 地点分の XML（文字列。保存時に Shift_JIS に変換する） */
export function buildJgs1433Xml(info: DeliveryInfo, point: Point, measurements: Measurement[]): string {
  if (measurements.length === 0) throw new Error(`${pointNameOf(point.pointNumber)} に記録がありません`);
  const dates = measurements.map((m) => localDate(m.recordedAt)).sort();
  const last = measurements[measurements.length - 1];
  const e = (tag: string, value: string | number = '') => `<${tag}>${typeof value === 'string' ? escapeXml(value) : value}</${tag}>`;

  const lines: string[] = [
    '<?xml version="1.0" encoding="Shift_JIS"?>',
    '<!DOCTYPE 簡易動的コーン貫入試験データシート情報 SYSTEM "B1433_03.DTD">',
    '<簡易動的コーン貫入試験データシート情報  DTD_version="03">',
    '<標題情報 DTD_version="03">',
    e('試験コード', 'B1433'),
    e('試験名称', '簡易動的コーン貫入試験'),
    e('規格番号'),
    e('基準番号', 'JGS 1433-2003'),
    e('調査件名', info.surveyTitle),
    e('試験開始年月日', dates[0]),
    e('試験終了年月日', dates[dates.length - 1]),
    e('試験者', info.testerName),
    e('調査業者名', info.contractorName),
    e('発注機関名称', info.clientName),
    '<位置情報>',
    e('地点名', pointNameOf(point.pointNumber)),
    e('フォルダ名'),
    '<経度>', e('経度_度'), e('経度_分'), e('経度_秒'), '</経度>',
    '<緯度>', e('緯度_度'), e('緯度_分'), e('緯度_秒'), '</緯度>',
    '<経緯度取得方法>', e('経緯度取得方法_コード'), e('経緯度取得方法_説明'), '</経緯度取得方法>',
    e('経緯度読取精度'),
    e('測地系', '0'),
    e('標高'),
    e('上端深度', '0.00'),
    e('下端深度', (last.cumulativeDepthCm / 100).toFixed(2)),
    '</位置情報>',
    '</標題情報>',
    '<試験情報>',
    '<測定>', e('打撃回数', 0), e('貫入深さ', 0), '</測定>',
  ];
  for (const m of measurements) {
    lines.push('<測定>', e('打撃回数', m.blowCount), e('貫入深さ', m.cumulativeDepthCm), e('貫入量', m.penetrationCm),
      e('Nd', ndOf(m.blowCount, m.penetrationCm)), '</測定>');
  }
  lines.push(
    '<グラフ DTD_version="03">',
    '<グラフ基本情報>', e('グラフ番号', 1), e('繰返し番号', 0), e('グラフタイトル', '深度-Ndグラフ'), e('グラフの向き', 0), '</グラフ基本情報>',
    '<グラフの位置>', e('横方向オフセット', 120), e('縦方向オフセット', 60), e('横方向長さ', 80), e('縦方向長さ', 100), '</グラフの位置>',
    '<外枠線の書式>', e('外枠線の書式_線種', '01'), '</外枠線の書式>',
    '<データ系列>',
    e('データ項目番号', 1), e('X項目名', 'Nd'), e('Y項目名', '深度'), e('データ番号', 1), e('データ名', 'Nd'),
    ...measurements.map((m) => e('XY値', `${ndOf(m.blowCount, m.penetrationCm)},${xyDepth(m.cumulativeDepthCm)}`)),
    '<データ系列_点の書式>', e('データ系列_点_スタイル', '03'), '</データ系列_点の書式>',
    '<データ系列_線の書式>', e('データ系列_線_線種', '01'), '</データ系列_線の書式>',
    e('使用するX軸番号', 1), e('使用するY軸番号', 2),
    '</データ系列>',
    ...axis({ no: 1, position: '03', title: 'Nd', titleOffsets: [5, 30], min: '0', max: '50', step: '10', cross: 2, reverse: '00' }),
    ...axis({ no: 2, position: '02', title: 'h (m)', titleOffsets: [2, 2], min: '0', max: depthAxisMax(last.cumulativeDepthCm), step: '0.1', cross: 1, reverse: '01' }),
    '</グラフ>',
    '</試験情報>',
    e('コメント'),
    '</簡易動的コーン貫入試験データシート情報>',
  );
  return lines.join(CRLF) + CRLF;

  function axis(a: { no: number; position: string; title: string; titleOffsets: [number, number]; min: string; max: string; step: string; cross: number; reverse: string }): string[] {
    return [
      '<軸>', e('軸番号', a.no), e('軸の位置', a.position), e('軸オフセット', 0),
      '<軸の書式>', e('軸_線種', '01'), '</軸の書式>',
      '<軸タイトル>', e('タイトル名', a.title), e('直交方向オフセット', a.titleOffsets[0]), e('水平方向オフセット', a.titleOffsets[1]), '</軸タイトル>',
      '<目盛>', e('最小値', a.min), e('最大値', a.max), e('目盛間隔', a.step), e('補助目盛間隔'), e('交差する軸番号', a.cross),
      e('軸交点', a.min), e('軸反転', a.reverse), e('使用する目盛', '00'), '</目盛>',
      '<目盛グリッド>', e('目盛グリッド_線種', '01'), '</目盛グリッド>',
      '<補助目盛グリッド>', e('補助目盛グリッド_線種', '02'), '</補助目盛グリッド>',
      '<目盛ラベル>', e('オフセット', 0), e('表示', '01'), '</目盛ラベル>',
      '</軸>',
    ];
  }
}
