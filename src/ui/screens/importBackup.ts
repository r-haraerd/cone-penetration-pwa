import { repository } from '../../db/repository';
import type { ProjectSnapshot } from '../../domain/types';
import { parseBackup } from '../../export/backup';
import { navigate } from '../../router';
import { formatDateTime, h } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';

function countMeasurements(snapshot: ProjectSnapshot): number {
  return snapshot.points.reduce((sum, p) => sum + p.measurements.length, 0);
}

/**
 * JSON バックアップから案件を復元する。
 * ファイル全体を検証してから書き込むので、壊れたファイルを選んでも端末のデータは変わらない。
 */
export async function importBackupScreen(): Promise<HTMLElement> {
  const fileInput = h('input', { id: 'backup-file', type: 'file', accept: '.json,application/json', class: 'visually-hidden' });
  const result = h('div', { class: 'import-result' });
  const error = errorText();

  const restore = async (snapshot: ProjectSnapshot, replace: boolean) => {
    try {
      await repository.importSnapshot(snapshot, replace);
      navigate(`/projects/${snapshot.project.id}`);
    } catch (e) {
      showError(error, e);
    }
  };

  const showSnapshot = async (snapshot: ProjectSnapshot, exportedAt: string) => {
    const { project } = snapshot;
    const summary = h('section', { class: 'card' },
      h('div', { class: 'card-title' }, h('span', { class: 'project-number' }, project.projectNumber), ' ', project.projectName),
      h('div', { class: 'card-meta' }, `${snapshot.points.length} 地点 ・ ${countMeasurements(snapshot)} 測定`),
      h('div', { class: 'card-meta' }, `最終更新 ${formatDateTime(project.updatedAt)}`),
      h('div', { class: 'card-meta' }, `バックアップ作成 ${formatDateTime(exportedAt)}`),
    );
    if (!(await repository.projectExists(project.id))) {
      result.replaceChildren(
        h('p', { class: 'ok-text' }, 'ファイルの検証に成功しました。'),
        summary,
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => void restore(snapshot, false) }, 'この案件を復元'),
      );
      return;
    }
    // 同じ案件が端末にある：置き換えるかどうかを比較して判断してもらう
    const current = await repository.getProjectSnapshot(project.id);
    const deviceNewer = current.project.updatedAt > project.updatedAt;
    const replace = async () => {
      const ok = await confirmDialog({
        message: '端末の案件をバックアップの内容で置き換えますか？',
        detail: deviceNewer ? '端末のデータの方が新しいため、バックアップ後の変更は失われます。' : '端末の現在のデータは失われます。',
        confirmLabel: '置き換える',
        danger: true,
      });
      if (ok) await restore(snapshot, true);
    };
    result.replaceChildren(
      h('p', { class: 'ok-text' }, 'ファイルの検証に成功しました。'),
      summary,
      h('p', { class: 'notice' },
        `この案件は既に端末にあります（${current.points.length} 地点・${countMeasurements(current)} 測定、最終更新 ${formatDateTime(current.project.updatedAt)}）。`,
        deviceNewer ? ' 端末のデータの方が新しいです。' : ''),
      h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => void replace() }, '端末の案件を置き換える'),
      h('a', { class: 'btn btn-secondary', href: `#/projects/${project.id}` }, '置き換えずに端末の案件を開く'),
    );
  };

  fileInput.addEventListener('change', async () => {
    error.textContent = '';
    result.replaceChildren();
    const file = fileInput.files?.[0];
    fileInput.value = ''; // 同じファイルを選び直せるように
    if (!file) return;
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        result.replaceChildren(
          h('p', { class: 'notice' }, `「${file.name}」は読み込めません。端末のデータは変更していません。`),
          h('ul', { class: 'error-list' }, ...parsed.errors.map((e) => h('li', {}, e))),
        );
        return;
      }
      await showSnapshot(parsed.snapshot, parsed.exportedAt);
    } catch (e) {
      showError(error, e);
    }
  });

  return screen({
    title: 'バックアップから復元',
    backHref: '#/',
    backLabel: '案件一覧',
    body: [
      h('p', { class: 'hint' }, 'このアプリで保存した JSON バックアップファイルを選んでください。'),
      h('label', { class: 'btn btn-primary btn-large file-button', for: 'backup-file' }, 'ファイルを選ぶ'),
      fileInput,
      error,
      result,
    ],
  });
}
