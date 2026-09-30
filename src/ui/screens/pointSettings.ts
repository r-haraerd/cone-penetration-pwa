import { repository } from '../../db/repository';
import { pointNameOf } from '../../domain/types';
import { normalizeDigits } from '../../domain/validation';
import { navigate, type Params } from '../../router';
import { h } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';

/**
 * 地点の番号入れ替えと記録の全削除（どちらも頻繁には使わないので地点画面から分けている）。
 * 例：K-4 で測定したのに K-3 に記録してしまった → K-3 を 4 番に変更すると K-3 と K-4 が記録ごと入れ替わる。
 */
export async function pointSettingsScreen({ pointId }: Params): Promise<HTMLElement> {
  const view = await repository.getPointView(pointId);
  const { point, project } = view;
  const name = pointNameOf(point.pointNumber);
  const points = await repository.listPointSummaries(project.id);
  const maxNumber = Math.max(...points.map((p) => p.pointNumber));
  const moveError = errorText();
  const clearError = errorText();

  const numberInput = h('input', {
    id: 'point-number', class: 'text-input point-number-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', value: String(point.pointNumber), 'aria-label': '新しい地点番号',
  });

  const move = async () => {
    const text = normalizeDigits(numberInput.value);
    const value = Number(text);
    if (!/^[0-9]+$/.test(text) || value < 1 || value > maxNumber) {
      moveError.textContent = `1～${maxNumber} の番号を入力してください（試験数量は ${maxNumber} 地点）`;
      return;
    }
    if (value === point.pointNumber) return;
    moveError.textContent = '';
    const other = points.find((p) => p.pointNumber === value);
    const target = pointNameOf(value);
    const ok = await confirmDialog({
      message: `${name} と ${target} を入れ替えますか？`,
      detail: `${name}（${view.measurementCount} 件）の記録は ${target} に、` +
        `${target}（${other?.measurementCount ?? 0} 件）の記録は ${name} になります。`,
      confirmLabel: '入れ替える',
    });
    if (!ok) return;
    try {
      await repository.movePoint(pointId, value);
      navigate(`/points/${pointId}`);
    } catch (e) {
      showError(moveError, e);
    }
  };

  const clear = async () => {
    const ok = await confirmDialog({
      message: `${name} の記録をすべて削除しますか？`,
      detail: `${view.measurementCount} 件の記録が削除され、${name} は未測定に戻ります。元に戻せません。`,
      confirmLabel: '記録をすべて削除',
      danger: true,
    });
    if (!ok) return;
    try {
      await repository.clearPoint(pointId);
      navigate(`/points/${pointId}`);
    } catch (e) {
      showError(clearError, e);
    }
  };

  return screen({
    title: `${name} の設定`,
    backHref: `#/points/${pointId}`,
    backLabel: `${name} 地点画面`,
    body: [
      h('section', { class: 'card' },
        h('h2', { class: 'card-heading' }, '地点番号の入れ替え'),
        h('p', { class: 'hint' }, '別の地点に記録してしまったときに使います。指定した番号の地点と、記録ごと入れ替わります。'),
        h('div', { class: 'renumber-row' },
          h('span', { class: 'renumber-prefix' }, 'K-'),
          numberInput,
          h('button', { type: 'button', class: 'btn btn-secondary renumber-btn', onclick: () => void move() }, '入れ替え'),
        ),
        moveError,
      ),
      h('section', { class: 'card danger-card' },
        h('h2', { class: 'card-heading' }, '記録の全削除'),
        view.measurementCount > 0
          ? h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => void clear() }, `${name} の記録をすべて削除`)
          : h('p', { class: 'hint' }, 'この地点にはまだ記録がありません。'),
        clearError,
      ),
    ],
  });
}
