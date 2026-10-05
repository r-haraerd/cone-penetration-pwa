import { repository } from '../../db/repository';
import { pointNameOf } from '../../domain/types';
import type { Params } from '../../router';
import { h } from '../dom';
import { screen } from '../components/layout';
import { measurementRow } from './pointDetail';

/** 地点の全測定記録（浅い順）。直近 5 件より前の記録を修正するときに使う */
export async function pointRecordsScreen({ pointId }: Params): Promise<HTMLElement> {
  const view = await repository.getPointView(pointId);
  const measurements = await repository.listMeasurements(pointId);
  const name = pointNameOf(view.point.pointNumber);
  return screen({
    title: `${name} すべての記録（${measurements.length} 件）`,
    backHref: `#/points/${pointId}`,
    backLabel: `${name} 地点画面`,
    body: [
      h('p', { class: 'hint' }, '修正・削除する記録をタップしてください'),
      measurements.length === 0
        ? h('p', { class: 'empty' }, 'まだ記録がありません')
        : h('ul', { class: 'record-list' }, ...measurements.map(measurementRow)),
    ],
  });
}
