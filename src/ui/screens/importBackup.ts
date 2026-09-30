import { repository } from '../../db/repository';
import type { ProjectSnapshot } from '../../domain/types';
import type { MatchBy } from '../../domain/merge';
import { parseBackup } from '../../export/backup';
import { navigate } from '../../router';
import { formatDateTime, h } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';
import { mergeReview } from './mergeReview';

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
    const startMerge = async (localProjectId: string, matchBy: MatchBy) => {
      try {
        result.replaceChildren(summary, await mergeReview(localProjectId, snapshot, matchBy));
        result.scrollIntoView({ block: 'start' });
      } catch (e) {
        showError(error, e);
      }
    };

    if (!(await repository.projectExists(project.id))) {
      // 別々に作った同じ業務番号の案件があれば、結合するか確認する
      const sameNumber = await repository.findProjectsByNumber(project.projectNumber, project.id);
      if (sameNumber.length > 0) {
        result.replaceChildren(
          h('p', { class: 'ok-text' }, 'ファイルの検証に成功しました。'),
          summary,
          h('p', { class: 'notice' }, `端末に同じ業務番号「${project.projectNumber}」の案件があります。同じ案件として結合しますか？（地点は K 番号で照合します）`),
          ...sameNumber.map((p) => h('button', {
            type: 'button', class: 'btn btn-primary', onclick: () => void startMerge(p.id, 'projectNumber'),
          }, `「${p.projectNumber} ${p.projectName}」と結合する`)),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => void restore(snapshot, false) }, '別の案件として復元'),
        );
        return;
      }
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
      h('p', { class: 'hint' }, '分担して記録したデータを集めるときは「結合」を選んでください。地点ごとに、記録がある方・新しい方を取り込みます。'),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => void startMerge(project.id, 'id') }, '結合して取り込む（おすすめ）'),
      h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => void replace() }, '端末の案件を置き換える'),
      h('a', { class: 'btn btn-secondary', href: `#/projects/${project.id}` }, '取り込まずに端末の案件を開く'),
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
    title: 'バックアップの取り込み',
    backHref: '#/',
    backLabel: '案件一覧',
    body: [
      h('p', { class: 'hint' }, 'このアプリで保存した JSON バックアップファイルを選んでください。端末の復元、配布された案件の受け取り、分担したデータの結合に使います。'),
      h('label', { class: 'btn btn-primary btn-large file-button', for: 'backup-file' }, 'ファイルを選ぶ'),
      fileInput,
      error,
      result,
    ],
  });
}
