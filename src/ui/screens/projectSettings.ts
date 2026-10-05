import { repository } from '../../db/repository';
import { MAX_POINTS, pointNameOf } from '../../domain/types';
import { normalizeDigits } from '../../domain/validation';
import { navigate, type Params } from '../../router';
import { h } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';

/** 試験数量の変更。増やすと末尾に地点を追加、減らすと末尾の未測定地点を削除する */
export async function projectSettingsScreen({ projectId }: Params): Promise<HTMLElement> {
  const project = await repository.getProject(projectId);
  const points = await repository.listPointSummaries(projectId);
  const current = points.length;
  const error = errorText();
  const countInput = h('input', {
    id: 'point-count', class: 'text-input count-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', value: String(current), 'aria-label': '試験数量',
  });

  const apply = async () => {
    error.textContent = '';
    const text = normalizeDigits(countInput.value);
    const next = /^[0-9]+$/.test(text) ? Number(text) : NaN;
    if (!Number.isInteger(next) || next < 1 || next > MAX_POINTS) {
      error.textContent = `試験数量は 1～${MAX_POINTS} の整数で入力してください`;
      return;
    }
    if (next === current) return;
    const detail = next > current
      ? `${pointNameOf(current + 1)}${next > current + 1 ? `〜${pointNameOf(next)}` : ''} を追加します。`
      : `${pointNameOf(next + 1)}${current > next + 1 ? `〜${pointNameOf(current)}` : ''} を削除します（記録がある地点は削除できません）。`;
    const ok = await confirmDialog({ message: `試験数量を ${current} → ${next} に変更しますか？`, detail, confirmLabel: '変更する' });
    if (!ok) return;
    try {
      await repository.setPointCount(projectId, next);
      navigate(`/projects/${projectId}`);
    } catch (e) {
      showError(error, e);
    }
  };

  return screen({
    title: `${project.projectNumber} ${project.projectName}`,
    backHref: `#/projects/${projectId}`,
    backLabel: '地点一覧',
    body: [
      h('section', { class: 'card' },
        h('h2', { class: 'card-heading' }, '試験数量の変更'),
        h('p', { class: 'hint' }, `現在 ${current} 地点（K-1〜${pointNameOf(current)}）。増やすと後ろに地点を追加し、減らすと後ろの未測定の地点を削除します。`),
        h('div', { class: 'count-row' },
          countInput,
          h('span', { class: 'unit' }, '地点'),
          h('button', { type: 'button', class: 'btn btn-secondary renumber-btn', onclick: () => void apply() }, '変更'),
        ),
        error,
      ),
    ],
  });
}
