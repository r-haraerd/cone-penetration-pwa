import { repository } from '../../db/repository';
import { nowIso } from '../../domain/ids';
import { buildBackup, serializeBackup } from '../../export/backup';
import { buildExcelCsv, checkCsvReadiness } from '../../export/csv';
import { navigate, type Params } from '../../router';
import { h } from '../dom';
import { backupStatus, confirmAndDeleteProject } from '../components/deleteProject';
import { errorText, screen, showError } from '../components/layout';
import { fileTimestamp, safeFileName, saveTextFile } from '../fileSave';
import { deliverySection } from './deliverySection';

export { backupStatus };

/** 案件のデータ出力（Excel 取込用 CSV・JSON バックアップ）と案件の削除 */
export async function projectDataScreen({ projectId }: Params): Promise<HTMLElement> {
  const snapshot = await repository.getProjectSnapshot(projectId);
  const { project } = snapshot;
  const readiness = checkCsvReadiness(snapshot);
  const baseName = `${safeFileName(project.projectNumber)}_${safeFileName(project.projectName)}_簡易貫入`;
  const csvMessage = h('p', { class: 'result-text', 'aria-live': 'polite' });
  const backupMessage = h('p', { class: 'result-text', 'aria-live': 'polite' });
  const csvError = errorText();
  const backupError = errorText();
  const deleteError = errorText();
  const status = backupStatus(project);
  const statusLine = h('p', { class: `backup-status ${status.stale ? 'stale' : 'fresh'}` }, status.text);

  const exportCsv = async () => {
    try {
      const fresh = await repository.getProjectSnapshot(projectId);
      const check = checkCsvReadiness(fresh);
      if (check.errors.length > 0) {
        csvError.textContent = check.errors.join('\n');
        return;
      }
      const outcome = await saveTextFile(`${baseName}_${fileTimestamp()}.csv`, buildExcelCsv(fresh), 'text/csv;charset=utf-8');
      if (outcome !== 'cancelled') csvMessage.textContent = `CSV を出力しました（${check.measurementCount} 件）`;
    } catch (e) {
      showError(csvError, e);
    }
  };

  const exportBackup = async () => {
    try {
      const fresh = await repository.getProjectSnapshot(projectId);
      const at = nowIso();
      const outcome = await saveTextFile(`${baseName}_backup_${fileTimestamp()}.json`, serializeBackup(buildBackup(fresh, at)), 'application/json');
      if (outcome === 'cancelled') return;
      await repository.markBackedUp(projectId, at);
      backupMessage.textContent = 'バックアップを保存しました';
      const s = backupStatus({ updatedAt: fresh.project.updatedAt, lastBackupAt: at });
      statusLine.textContent = s.text;
      statusLine.className = 'backup-status fresh';
    } catch (e) {
      showError(backupError, e);
    }
  };

  const removeProject = async () => {
    try {
      if (await confirmAndDeleteProject(projectId)) navigate('/');
    } catch (e) {
      showError(deleteError, e);
    }
  };

  const csvSection = h('section', { class: 'card' },
    h('h2', { class: 'card-heading' }, 'Excel 取込用 CSV'),
    h('p', { class: 'hint' }, '0540_簡易貫入試験_現場データ取込.xlsm の「現場データ取込」ボタンで読み込むファイルです。'),
    ...readiness.errors.map((e) => h('p', { class: 'notice' }, e)),
    ...readiness.notes.map((n) => h('p', { class: 'hint' }, `・${n}`)),
    readiness.errors.length === 0
      ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void exportCsv() }, `CSV を出力（${readiness.measurementCount} 件）`)
      : null,
    csvError,
    csvMessage,
  );

  const backupSection = h('section', { class: 'card' },
    h('h2', { class: 'card-heading' }, 'バックアップ（JSON）'),
    h('p', { class: 'hint' }, '案件の全データを 1 ファイルに保存します。端末の故障・紛失・機種変更のときは、案件一覧の「バックアップの取り込み」で元に戻せます。'),
    h('p', { class: 'hint' }, '複数人で分担するとき：出発前にこのファイルをメンバーに配り、帰社後はメンバーのファイルを代表者が「取り込み」→「結合」します。'),
    statusLine,
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void exportBackup() }, 'JSON バックアップを保存'),
    backupError,
    backupMessage,
  );

  const deleteSection = h('section', { class: 'card danger-card' },
    h('h2', { class: 'card-heading' }, '案件の削除'),
    h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => void removeProject() }, 'この案件を削除'),
    deleteError,
  );

  return screen({
    title: `${project.projectNumber} ${project.projectName}`,
    backHref: `#/projects/${projectId}`,
    backLabel: '地点一覧',
    body: [h('h2', { class: 'section-title' }, 'データ出力・バックアップ'), csvSection, deliverySection(snapshot), backupSection, deleteSection],
  });
}
