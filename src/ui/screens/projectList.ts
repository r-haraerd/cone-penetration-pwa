import { repository } from '../../db/repository';
import { formatDateTime, h } from '../dom';
import { screen } from '../components/layout';
import { confirmAndDeleteProject } from '../components/deleteProject';
import { navigate } from '../../router';
import { installHint } from '../pwa';
import { projectDbAvailable } from '../../api/projectDb';

export async function projectListScreen(): Promise<HTMLElement> {
  const projects = await repository.listProjectSummaries();
  const alertText = h('p', { class: 'error-text list-alert', role: 'alert' });

  const list = projects.length === 0
    ? [h('p', { class: 'empty' }, '案件がありません。下の「＋ 新しい案件」から作成してください。')]
    : projects.map((p) =>
        // カード全体が「開く」リンク。削除ボタンはリンクの外（兄弟要素）に置き、右下に重ねる
        h('div', { class: 'project-item' },
          h('a', { class: 'card card-link project-card', href: `#/projects/${p.id}` },
            h('div', { class: 'card-title' }, h('span', { class: 'project-number' }, p.projectNumber), ' ', p.projectName),
            h('div', { class: 'card-meta' }, `試験数量 ${p.pointCount} 地点 ・ 記録あり ${p.measuredPointCount}`),
            h('div', { class: 'card-meta' }, `最終更新 ${formatDateTime(p.updatedAt)}`),
            h('span', { class: 'card-open' }, '開く ›'),
          ),
          h('button', {
            type: 'button', class: 'project-delete', 'aria-label': `${p.projectNumber} ${p.projectName} を削除`,
            onclick: async () => {
              try {
                // 一覧を描き直す（同じ画面への遷移は再描画になる）
                if (await confirmAndDeleteProject(p.id)) navigate('/');
              } catch (e) {
                alertText.textContent = e instanceof Error ? e.message : String(e);
              }
            },
          }, '削除'),
        ),
      );

  return screen({
    title: '簡易動的コーン貫入試験',
    body: [
      alertText,
      ...list,
      installHint(),
      h('p', { class: 'app-version' }, `バージョン ${__APP_VERSION__}（${formatDateTime(__BUILD_TIME__)} ビルド）`),
    ],
    footer: [
      h('a', { class: 'btn btn-primary btn-large', href: '#/projects/new' }, '＋ 新しい案件'),
      h('a', { class: 'footer-link', href: '#/import' }, 'バックアップの取り込み（復元・受け取り・結合）'),
      ...(projectDbAvailable() ? [h('a', { class: 'footer-link', href: '#/settings' }, '業務DB連携の設定')] : []),
    ],
  });
}
