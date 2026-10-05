import { repository } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { nowIso } from '../../domain/ids';
import { conflictsOf, planMerge, resolveMerge, type MatchBy, type Side } from '../../domain/merge';
import { pointNameOf, type Measurement, type ProjectSnapshot } from '../../domain/types';
import { navigate } from '../../router';
import { formatDateTime, h } from '../dom';
import { errorText, showError } from '../components/layout';

function describeRecords(measurements: Measurement[]): string {
  if (measurements.length === 0) return '記録なし';
  const last = measurements[measurements.length - 1];
  return `${measurements.length} 件 ・ 深度 ${formatDepthM(last.cumulativeDepthCm)} m ・ 最終 ${formatDateTime(last.recordedAt)}`;
}

/**
 * 結合内容の確認画面（取り込み画面の中に表示する）。
 * 自動で決まる地点は一覧で示し、両方に記録がある地点（競合）だけ利用者に選んでもらう。
 */
export async function mergeReview(localProjectId: string, incoming: ProjectSnapshot, matchBy: MatchBy): Promise<HTMLElement> {
  const local = await repository.getProjectSnapshot(localProjectId);
  const plan = planMerge(local, incoming, matchBy);
  const conflicts = conflictsOf(plan);
  const choices: Record<number, Side> = {};
  const error = errorText();
  let busy = false;

  const takes = plan.items.filter((i) => i.kind === 'take' || i.kind === 'add').map((i) => pointNameOf(i.pointNumber));
  const keeps = plan.items.filter((i) => i.kind === 'keep' && i.reason === 'localExtends').map((i) => pointNameOf(i.pointNumber));

  const mergeButton = h('button', { type: 'button', class: 'btn btn-primary btn-large', 'data-merge': true }, '結合する');
  const updateButton = () => {
    const remaining = conflicts.filter((c) => !choices[c.pointNumber]).length;
    mergeButton.disabled = remaining > 0;
    mergeButton.textContent = remaining > 0 ? `残り ${remaining} 地点を選んでください` : '結合する';
  };

  const conflictCards = conflicts.map((c) => {
    const name = pointNameOf(c.pointNumber);
    const option = (side: Side, label: string, records: Measurement[]) => {
      const button = h('button', { type: 'button', class: 'choice-btn', 'data-side': side, 'aria-pressed': 'false' },
        h('span', { class: 'choice-label' }, label),
        h('span', { class: 'choice-detail' }, describeRecords(records)),
      );
      button.addEventListener('click', () => {
        choices[c.pointNumber] = side;
        card.querySelectorAll('.choice-btn').forEach((b) => {
          const selected = b === button;
          b.classList.toggle('selected', selected);
          b.setAttribute('aria-pressed', String(selected));
        });
        updateButton();
      });
      return button;
    };
    const card = h('section', { class: 'card conflict-card', 'data-point': name },
      h('h3', { class: 'card-heading' }, `${name}：両方に別々の記録があります`),
      h('p', { class: 'hint' }, 'どちらの記録を残すか選んでください。選ばなかった方の記録は、この地点から消えます。'),
      option('local', 'この端末の記録を残す', c.local.measurements),
      option('incoming', 'ファイルの記録を採用', c.incoming.measurements),
    );
    return card;
  });

  mergeButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      await repository.applyMerge(resolveMerge(plan, choices, nowIso()));
      navigate(`/projects/${localProjectId}`);
    } catch (e) {
      showError(error, e);
    } finally {
      busy = false;
    }
  });
  updateButton();

  return h('div', { class: 'merge-review' },
    h('h2', { class: 'section-title' }, `「${local.project.projectNumber} ${local.project.projectName}」に結合します`),
    h('p', { class: 'hint' }, matchBy === 'id'
      ? '同じ案件（配布されたもの）として、地点どうしを照合しました。'
      : '業務番号が同じ別の案件として、K 番号で地点を照合しました。'),
    h('ul', { class: 'merge-summary' },
      h('li', {}, h('strong', {}, 'ファイルから取り込む：'), takes.length ? takes.join('、') : 'なし'),
      keeps.length ? h('li', {}, h('strong', {}, 'この端末の方が新しい（そのまま）：'), keeps.join('、')) : null,
      h('li', {}, h('strong', {}, '選択が必要：'), conflicts.length ? conflicts.map((c) => pointNameOf(c.pointNumber)).join('、') : 'なし'),
    ),
    ...plan.renumbered.map((r) =>
      h('p', { class: 'hint' }, `・ファイルの ${pointNameOf(r.incomingNumber)} は、この端末では ${pointNameOf(r.localNumber)} です（番号の入れ替え済み）。この端末の番号を使います。`)),
    plan.skipped.length
      ? h('p', { class: 'notice' }, `${plan.skipped.map(pointNameOf).join('、')}（ファイル側）は照合できる地点がないため取り込みません。内容を確認してください。`)
      : null,
    ...conflictCards,
    error,
    mergeButton,
  );
}
