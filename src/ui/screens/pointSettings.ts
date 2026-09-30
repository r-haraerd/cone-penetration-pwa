import { repository } from '../../db/repository';
import { MAX_POINTS, pointNameOf } from '../../domain/types';
import { normalizeDigits } from '../../domain/validation';
import { navigate, type Params } from '../../router';
import { h } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';

/** 地点番号の付け替えと地点の削除（どちらも頻繁には使わないので地点画面から分けている） */
export async function pointSettingsScreen({ pointId }: Params): Promise<HTMLElement> {
  const view = await repository.getPointView(pointId);
  const { point, project } = view;
  const name = pointNameOf(point.pointNumber);
  const others = (await repository.listPointSummaries(project.id)).filter((p) => p.id !== point.id);
  const deletable = await repository.canDeletePoint(pointId);
  const renumberError = errorText();
  const deleteError = errorText();

  const numberInput = h('input', {
    id: 'point-number', class: 'text-input point-number-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', value: String(point.pointNumber), 'aria-label': '新しい地点番号',
  });

  const renumber = async () => {
    const text = normalizeDigits(numberInput.value);
    const value = Number(text);
    if (!/^[0-9]+$/.test(text) || value < 1 || value > MAX_POINTS) {
      renumberError.textContent = `1～${MAX_POINTS} の番号を入力してください`;
      return;
    }
    if (value === point.pointNumber) return;
    if (others.some((p) => p.pointNumber === value)) {
      renumberError.textContent = `${pointNameOf(value)} は既に使われています`;
      return;
    }
    renumberError.textContent = '';
    const ok = await confirmDialog({
      message: `${name} を ${pointNameOf(value)} に変更しますか？`,
      confirmLabel: '番号を変更',
    });
    if (!ok) return;
    try {
      await repository.renumberPoint(pointId, value);
      navigate(`/points/${pointId}`);
    } catch (e) {
      showError(renumberError, e);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      message: `${name} を削除しますか？`,
      detail: view.measurementCount > 0 ? `測定記録 ${view.measurementCount} 件もすべて削除されます。元に戻せません。` : '元に戻せません。',
      confirmLabel: '地点を削除',
      danger: true,
    });
    if (!ok) return;
    try {
      await repository.deletePoint(pointId);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      showError(deleteError, e);
    }
  };

  const usedText = others.length > 0
    ? `使用中：${others.map((p) => pointNameOf(p.pointNumber)).join('、')}`
    : '';

  return screen({
    title: `${name} の設定`,
    backHref: `#/points/${pointId}`,
    backLabel: `${name} 地点画面`,
    body: [
      h('section', { class: 'card' },
        h('h2', { class: 'card-heading' }, '地点番号の変更'),
        h('p', { class: 'hint' }, '番号を間違えて開始した場合などに使います。Excel 取込では K-1 から欠番のない連番が必要です。'),
        h('div', { class: 'renumber-row' },
          h('span', { class: 'renumber-prefix' }, 'K-'),
          numberInput,
          h('button', { type: 'button', class: 'btn btn-secondary renumber-btn', onclick: () => void renumber() }, '変更'),
        ),
        usedText ? h('p', { class: 'hint' }, usedText) : '',
        renumberError,
      ),
      h('section', { class: 'card danger-card' },
        h('h2', { class: 'card-heading' }, '地点の削除'),
        deletable.ok
          ? h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => void remove() }, `${name} を削除`)
          : h('p', { class: 'hint' }, deletable.reason ?? ''),
        deleteError,
      ),
    ],
  });
}
