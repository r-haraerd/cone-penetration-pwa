import { repository } from '../../db/repository';
import { formatDateTime } from '../dom';
import { confirmDialog } from './confirmDialog';

/** 最後の変更がバックアップ後か */
export function backupStatus(project: { updatedAt: string; lastBackupAt?: string | null }): { text: string; stale: boolean } {
  if (!project.lastBackupAt) return { text: 'バックアップ：まだ保存していません', stale: true };
  const stale = project.updatedAt > project.lastBackupAt;
  return {
    text: `バックアップ：${formatDateTime(project.lastBackupAt)}${stale ? '（その後に変更あり）' : '（最新）'}`,
    stale,
  };
}

/**
 * 案件を削除する（確認ダイアログつき）。案件一覧と「データ出力・バックアップ」画面の両方から使う。
 * 削除したら true、取り消したら false。
 */
export async function confirmAndDeleteProject(projectId: string): Promise<boolean> {
  const snapshot = await repository.getProjectSnapshot(projectId);
  const { project } = snapshot;
  const count = snapshot.points.reduce((sum, p) => sum + p.measurements.length, 0);
  const ok = await confirmDialog({
    message: `案件「${project.projectNumber} ${project.projectName}」を削除しますか？`,
    detail: `${snapshot.points.length} 地点・${count} 測定がこの端末から削除され、元に戻せません。` +
      (count > 0 && backupStatus(project).stale ? '\n最新のバックアップがありません。先に JSON バックアップを保存することをおすすめします。' : ''),
    confirmLabel: '案件を削除',
    danger: true,
  });
  if (!ok) return false;
  await repository.deleteProject(projectId);
  return true;
}
