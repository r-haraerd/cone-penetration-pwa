import { repository } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { DEFAULT_PENETRATION_CM, MAX_MEASUREMENTS_PER_POINT, pointNameOf, type Measurement } from '../../domain/types';
import { navigate, type Params } from '../../router';
import { h, type Child } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';
import { pointState } from './projectDetail';

/** 測定記録の 1 行。タップで修正画面を開く */
export function measurementRow(m: Measurement): HTMLElement {
  return h('li', {},
    h('a', { class: 'record-row', href: `#/measurements/${m.id}` },
      h('span', { class: 'record-seq' }, `No.${m.sequence}`),
      h('span', { class: 'record-depth' }, `${formatDepthM(m.cumulativeDepthCm)} m`),
      h('span', { class: 'record-blow' }, `${m.blowCount} 回`),
      h('span', { class: 'record-pen' }, m.penetrationCm !== DEFAULT_PENETRATION_CM ? `${m.penetrationCm} cm` : ''),
      h('span', { class: 'record-chevron', 'aria-hidden': 'true' }, '›'),
    ),
  );
}

export async function pointDetailScreen({ pointId }: Params): Promise<HTMLElement> {
  const view = await repository.getPointView(pointId);
  const { point, project } = view;
  const name = pointNameOf(point.pointNumber);
  const isActive = point.status === 'active';
  const error = errorText();

  const finish = async () => {
    const ok = await confirmDialog({
      message: `${name} を終了しますか？`,
      detail: `現在深度 ${formatDepthM(view.currentDepthCm)} m ・ ${view.measurementCount} 測定`,
      confirmLabel: '地点を終了',
    });
    if (!ok) return;
    try {
      await repository.finishPoint(pointId);
      navigate(`/points/${pointId}`);
    } catch (e) {
      showError(error, e);
    }
  };

  const reopen = async () => {
    const ok = await confirmDialog({
      message: `${name} の測定を再開しますか？`,
      detail: `No.${view.measurementCount + 1}（${formatDepthM(view.currentDepthCm)} m の次）から記録を続けます。`,
      confirmLabel: '再開する',
    });
    if (!ok) return;
    try {
      await repository.reopenPoint(pointId);
      navigate(`/points/${pointId}/measure`);
    } catch (e) {
      showError(error, e);
    }
  };
  const state = pointState({ status: point.status, measurementCount: view.measurementCount });

  const body: Child[] = [
    h('div', { class: 'point-hero' },
      h('div', { class: 'point-hero-name' }, name,
        h('span', { class: `status-chip ${state.key}` }, state.label)),
      h('div', { class: 'depth-label' }, '現在深度'),
      h('div', { class: 'depth-value' }, formatDepthM(view.currentDepthCm), h('span', { class: 'depth-unit' }, ' m')),
      h('div', { class: 'point-count' }, `測定数 ${view.measurementCount}`),
    ),
    h('h2', { class: 'section-title' }, '直近の記録'),
    view.recent.length === 0
      ? h('p', { class: 'empty' }, 'まだ記録がありません')
      : h('ul', { class: 'record-list' }, ...view.recent.map(measurementRow)),
    view.measurementCount > view.recent.length
      ? h('a', { class: 'link-row', href: `#/points/${pointId}/records` }, `すべての記録を見る（${view.measurementCount} 件） ›`)
      : '',
    view.recent.length > 0 ? h('p', { class: 'hint' }, '記録をタップすると修正・削除できます') : '',
    error,
    h('a', { class: 'link-row subtle', href: `#/points/${pointId}/settings` }, '地点番号の入れ替え・記録の全削除 ›'),
  ];

  const footer: Node[] = [];
  if (isActive) {
    if (view.measurementCount < MAX_MEASUREMENTS_PER_POINT) {
      footer.push(h('a', { class: 'btn btn-primary btn-large', href: `#/points/${pointId}/measure` },
        view.measurementCount === 0 ? '測定を開始' : '測定を続ける'));
    } else {
      footer.push(h('p', { class: 'footer-note' }, `${MAX_MEASUREMENTS_PER_POINT} 測定に達しました`));
    }
    if (view.measurementCount > 0) {
      footer.push(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => void finish() }, '地点終了'));
    }
  } else {
    // 終了した地点：次に記録する地点を選びに一覧へ戻るのが通常の流れ
    footer.push(h('a', { class: 'btn btn-primary btn-large', href: `#/projects/${project.id}` }, '地点一覧へ（次の地点を選ぶ）'));
    if (view.measurementCount < MAX_MEASUREMENTS_PER_POINT) {
      footer.push(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => void reopen() }, '測定を再開'));
    }
  }

  return screen({
    title: `${project.projectNumber} ${project.projectName}`,
    backHref: `#/projects/${project.id}`,
    backLabel: '地点一覧',
    body,
    footer,
  });
}
