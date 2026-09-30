import { repository, type PointSummary } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { pointNameOf } from '../../domain/types';
import type { Params } from '../../router';
import { h } from '../dom';
import { screen } from '../components/layout';
import { backupStatus } from './projectData';

/** 地点の状態（画面表示用）。記録がなければ「未測定」 */
export function pointState(p: { status: string; measurementCount: number }): { key: 'todo' | 'doing' | 'done'; label: string } {
  if (p.status === 'finished') return { key: 'done', label: '終了' };
  if (p.measurementCount === 0) return { key: 'todo', label: '未測定' };
  return { key: 'doing', label: '測定中' };
}

function pointTile(p: PointSummary): HTMLElement {
  const state = pointState(p);
  return h('a', { class: `point-tile ${state.key}`, href: `#/points/${p.id}`, 'data-point': pointNameOf(p.pointNumber) },
    h('span', { class: 'tile-name' }, pointNameOf(p.pointNumber)),
    h('span', { class: 'tile-depth' }, p.measurementCount > 0 ? `${formatDepthM(p.currentDepthCm)} m` : '―'),
    h('span', { class: 'tile-state' }, state.label),
  );
}

/** 案件画面：K-1〜K-n から記録する地点を選ぶ */
export async function projectDetailScreen({ projectId }: Params): Promise<HTMLElement> {
  const project = await repository.getProject(projectId);
  const points = await repository.listPointSummaries(projectId);
  const measured = points.filter((p) => p.measurementCount > 0).length;
  const finished = points.filter((p) => p.status === 'finished').length;
  const backup = backupStatus(project);

  return screen({
    title: `${project.projectNumber} ${project.projectName}`,
    backHref: '#/',
    backLabel: '案件一覧',
    body: [
      h('div', { class: 'progress-line' },
        h('span', {}, `試験数量 ${points.length} 地点`),
        h('span', {}, `記録あり ${measured} ・ 終了 ${finished}`),
      ),
      h('p', { class: 'hint' }, '記録する地点を選んでください'),
      points.length === 0
        ? h('p', { class: 'empty' }, '地点がありません。「試験数量の変更」で地点数を設定してください。')
        : h('div', { class: 'point-grid' }, ...points.map(pointTile)),
      h('a', { class: 'card card-link data-link', href: `#/projects/${projectId}/data` },
        h('div', { class: 'card-heading' }, 'データ出力・バックアップ'),
        h('div', { class: `backup-status ${backup.stale ? 'stale' : 'fresh'}` }, backup.text),
        h('span', { class: 'card-open' }, '›'),
      ),
      h('a', { class: 'link-row subtle', href: `#/projects/${projectId}/settings` }, '試験数量の変更 ›'),
    ],
  });
}
