import { repository } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { pointNameOf } from '../../domain/types';
import { parseBlowCount } from '../../domain/validation';
import { navigate, type Params } from '../../router';
import { h } from '../dom';
import { confirmDialog } from '../components/confirmDialog';
import { errorText, screen, showError } from '../components/layout';
import { penetrationPicker } from '../components/penetrationPicker';

/** 修正・削除が済んだら、開いた元の画面（地点画面または全記録一覧）へ戻る */
function goBack(pointId: string): void {
  if (history.length > 1) history.back();
  else navigate(`/points/${pointId}`);
}

function signedCm(diff: number): string {
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} cm`;
}

export async function measurementEditScreen({ measurementId }: Params): Promise<HTMLElement> {
  const view = await repository.getMeasurementView(measurementId);
  const { point, measurement: m } = view;
  const name = pointNameOf(point.pointNumber);
  const error = errorText();
  let busy = false;

  const blowInput = h('input', {
    id: 'blow-count', class: 'number-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': '打撃回数', value: String(m.blowCount),
  });
  const preview = h('div', { class: 'edit-preview', 'aria-live': 'polite' });

  const refresh = () => {
    const pen = picker.current();
    if (pen === null || pen === m.penetrationCm) {
      preview.textContent = '';
      preview.hidden = true;
      return;
    }
    const diff = pen - m.penetrationCm;
    const lines = [`この記録の深度 ${formatDepthM(m.cumulativeDepthCm)} m → ${formatDepthM(view.previousDepthCm + pen)} m`];
    if (view.followingCount > 0) lines.push(`以降の ${view.followingCount} 件の深度も ${signedCm(diff)} 補正されます`);
    preview.replaceChildren(...lines.map((t) => h('div', {}, t)));
    preview.hidden = false;
  };
  const picker = penetrationPicker(m.penetrationCm, () => {
    error.textContent = '';
    refresh();
  });
  blowInput.addEventListener('input', () => (error.textContent = ''));

  const save = async () => {
    if (busy) return;
    const blow = parseBlowCount(blowInput.value);
    if (!blow.ok) {
      error.textContent = blow.message;
      blowInput.focus();
      return;
    }
    const pen = picker.read();
    if (!pen.ok) {
      error.textContent = pen.message;
      picker.focusOther();
      return;
    }
    busy = true;
    try {
      await repository.updateMeasurement(m.id, blow.value, pen.value);
      goBack(point.id);
    } catch (e) {
      showError(error, e);
    } finally {
      busy = false;
    }
  };

  const remove = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      message: 'この測定記録を削除しますか？',
      detail: `${name} No.${m.sequence}：${formatDepthM(m.cumulativeDepthCm)} m ・ ${m.blowCount} 回 ・ ${m.penetrationCm} cm` +
        (view.followingCount > 0 ? `\n以降の ${view.followingCount} 件の深度を ${signedCm(-m.penetrationCm)} 補正します。` : ''),
      confirmLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    busy = true;
    try {
      await repository.deleteMeasurement(m.id);
      goBack(point.id);
    } catch (e) {
      showError(error, e);
    } finally {
      busy = false;
    }
  };

  const form = h('form', { class: 'measure-form', novalidate: true },
    h('div', { class: 'measure-depth' },
      h('div', { class: 'depth-label' }, `No.${m.sequence} の深度`),
      h('div', { class: 'depth-value' }, formatDepthM(m.cumulativeDepthCm), h('span', { class: 'depth-unit' }, ' m')),
    ),
    h('label', { class: 'field-label', for: 'blow-count' }, '打撃回数'),
    blowInput,
    h('div', { class: 'field-label' }, '今回貫入量'),
    ...picker.elements,
    preview,
    error,
    h('div', { class: 'danger-zone' },
      h('button', { type: 'button', class: 'btn btn-danger-outline', onclick: () => void remove() }, 'この測定記録を削除'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });
  refresh();

  return screen({
    title: `${name} No.${m.sequence} の修正`,
    backHref: `#/points/${point.id}`,
    backLabel: `${name} 地点画面`,
    body: [form],
    footer: [
      h('button', { type: 'button', class: 'btn btn-primary btn-save', onclick: () => void save() }, '修正を保存'),
    ],
  });
}
