import { repository } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { DEFAULT_PENETRATION_CM, MAX_MEASUREMENTS_PER_POINT, MAX_POINTS, pointNameOf, type Measurement } from '../../domain/types';
import { navigate, type Params } from '../../router';
import { h, type Child } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';

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

  const startNext = async () => {
    try {
      const next = await repository.startNextPoint(project.id);
      navigate(`/points/${next.id}/measure`);
    } catch (e) {
      showError(error, e);
    }
  };

  const body: Child[] = [
    h('div', { class: 'point-hero' },
      h('div', { class: 'point-hero-name' }, name,
        h('span', { class: `status-chip ${point.status}` }, isActive ? '測定中' : '終了')),
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
    h('a', { class: 'link-row subtle', href: `#/points/${pointId}/settings` }, '地点番号の変更・地点の削除 ›'),
  ];

  const footer: Node[] = [];
  if (isActive) {
    if (view.measurementCount < MAX_MEASUREMENTS_PER_POINT) {
      footer.push(h('a', { class: 'btn btn-primary btn-large', href: `#/points/${pointId}/measure` }, '測定を続ける'));
    } else {
      footer.push(h('p', { class: 'footer-note' }, `${MAX_MEASUREMENTS_PER_POINT} 測定に達しました`));
    }
    if (view.measurementCount > 0) {
      footer.push(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => void finish() }, '地点終了'));
    }
  } else {
    const points = await repository.listPointSummaries(project.id);
    const hasActive = points.some((p) => p.status === 'active');
    const nextNumber = points.reduce((max, p) => Math.max(max, p.pointNumber), 0) + 1;
    if (!hasActive && nextNumber <= MAX_POINTS) {
      footer.push(h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => void startNext() },
        `次の地点 ${pointNameOf(nextNumber)} を開始`));
    }
    footer.push(h('a', { class: 'btn btn-secondary', href: `#/projects/${project.id}` }, '地点一覧へ'));
  }

  return screen({
    title: `${project.projectNumber} ${project.projectName}`,
    backHref: `#/projects/${project.id}`,
    backLabel: '地点一覧',
    body,
    footer,
  });
}
