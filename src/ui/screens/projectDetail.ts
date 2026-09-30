import { repository } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { MAX_POINTS, pointNameOf } from '../../domain/types';
import { navigate, type Params } from '../../router';
import { h } from '../dom';
import { errorText, screen, showError } from '../components/layout';
import { backupStatus } from './projectData';

export async function projectDetailScreen({ projectId }: Params): Promise<HTMLElement> {
  const project = await repository.getProject(projectId);
  const points = await repository.listPointSummaries(projectId);
  const active = points.find((p) => p.status === 'active');
  const nextNumber = points.reduce((max, p) => Math.max(max, p.pointNumber), 0) + 1;
  const error = errorText();
  const backup = backupStatus(project);

  const list = points.length === 0
    ? [h('p', { class: 'empty' }, '試験地点はまだありません。')]
    : points.map((p) =>
        h('a', { class: `card card-link point-card ${p.status}`, href: `#/points/${p.id}` },
          h('div', { class: 'point-card-row' },
            h('span', { class: 'point-name' }, pointNameOf(p.pointNumber)),
            h('span', { class: `status-chip ${p.status}` }, p.status === 'active' ? '測定中' : '終了'),
          ),
          h('div', { class: 'card-meta' }, `${formatDepthM(p.currentDepthCm)} m ・ ${p.measurementCount} 測定`),
        ),
      );

  // 欠番があると Excel 取込で拒否されるので、現場で気付けるよう知らせる
  const used = new Set(points.map((p) => p.pointNumber));
  const missing: string[] = [];
  for (let n = 1; n < nextNumber; n++) if (!used.has(n)) missing.push(pointNameOf(n));
  const gapNotice = missing.length > 0
    ? h('p', { class: 'notice' }, `欠番があります：${missing.join('、')}。Excel 取込には K-1 からの連番が必要です（地点の設定で番号を変更できます）。`)
    : null;

  const startNext = async () => {
    try {
      const point = await repository.startNextPoint(projectId);
      navigate(`/points/${point.id}/measure`);
    } catch (e) {
      showError(error, e);
    }
  };

  let footer: Node[];
  if (active) {
    footer = [h('a', { class: 'btn btn-primary btn-large', href: `#/points/${active.id}` }, `${pointNameOf(active.pointNumber)} の測定を続ける`)];
  } else if (nextNumber <= MAX_POINTS) {
    footer = [h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => void startNext() }, `＋ ${pointNameOf(nextNumber)} を開始`)];
  } else {
    footer = [h('p', { class: 'footer-note' }, `${MAX_POINTS} 地点に達しました`)];
  }

  return screen({
    title: `${project.projectNumber} ${project.projectName}`,
    backHref: '#/',
    backLabel: '案件一覧',
    body: [
      gapNotice,
      h('h2', { class: 'section-title' }, `試験地点（${points.length}/${MAX_POINTS}）`),
      ...list,
      error,
      h('a', { class: 'card card-link data-link', href: `#/projects/${projectId}/data` },
        h('div', { class: 'card-heading' }, 'データ出力・バックアップ'),
        h('div', { class: `backup-status ${backup.stale ? 'stale' : 'fresh'}` }, backup.text),
        h('span', { class: 'card-open' }, '›'),
      ),
    ],
    footer,
  });
}
