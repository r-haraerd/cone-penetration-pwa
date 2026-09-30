import { repository } from '../../db/repository';
import { formatDepthM } from '../../domain/depth';
import { DEFAULT_PENETRATION_CM, MAX_MEASUREMENTS_PER_POINT, pointNameOf } from '../../domain/types';
import { parseBlowCount } from '../../domain/validation';
import { navigate, type Params } from '../../router';
import { h, keepFocusOnPress } from '../dom';
import { errorText, screen, showError } from '../components/layout';
import { penetrationPicker } from '../components/penetrationPicker';

/**
 * 測定入力画面（最重要画面）。
 * 通常操作は「打撃回数を入力 → 保存して次へ」の 2 動作。保存後は画面を作り直さず、
 * 同じ入力欄を空にして次深度を表示するので、数字キーボードも閉じない。
 */
export async function measureScreen({ pointId }: Params): Promise<HTMLElement> {
  const view = await repository.getPointView(pointId);
  const { point } = view;
  const name = pointNameOf(point.pointNumber);
  if (point.status !== 'active') {
    // 終了済み地点には追加させず地点画面へ
    queueMicrotask(() => navigate(`/points/${pointId}`));
    return screen({ title: name, body: [] });
  }

  let currentDepthCm = view.currentDepthCm;
  let count = view.measurementCount;
  let saving = false;

  const depthValue = h('div', { class: 'depth-value' });
  const blowInput = h('input', {
    id: 'blow-count', class: 'number-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': '打撃回数', 'data-autofocus': true,
  });
  const nextDepth = h('div', { class: 'next-depth' });
  const lastSaved = h('div', { class: 'last-saved', 'aria-live': 'polite' });
  const counter = h('div', { class: 'point-count' });
  const error = errorText();

  const refresh = () => {
    depthValue.replaceChildren(formatDepthM(currentDepthCm), h('span', { class: 'depth-unit' }, ' m'));
    const pen = picker.current();
    nextDepth.textContent = pen === null ? '次深度 → ―' : `次深度 → ${formatDepthM(currentDepthCm + pen)} m`;
    counter.textContent = `測定数 ${count}`;
  };
  const picker = penetrationPicker(DEFAULT_PENETRATION_CM, () => {
    error.textContent = '';
    refresh();
  });

  blowInput.addEventListener('input', () => (error.textContent = ''));
  // キーボードが開いて画面が縮んでも入力欄が見える位置へ
  blowInput.addEventListener('focus', () => setTimeout(() => blowInput.scrollIntoView({ block: 'nearest' }), 300));

  const save = async () => {
    if (saving) return; // 二重タップ防止
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

    saving = true;
    saveButton.disabled = true;
    try {
      const saved = await repository.addMeasurement(pointId, blow.value, pen.value);
      currentDepthCm = saved.cumulativeDepthCm;
      count = saved.sequence;
      lastSaved.textContent = `保存しました：${formatDepthM(saved.cumulativeDepthCm)} m ・ ${saved.blowCount} 回` +
        (saved.penetrationCm !== DEFAULT_PENETRATION_CM ? ` ・ ${saved.penetrationCm} cm` : '');
      lastSaved.classList.remove('flash');
      void lastSaved.offsetWidth; // アニメーションを再生し直す
      lastSaved.classList.add('flash');
      // 次の測定に備えて初期状態へ（貫入量は 10 cm に戻す）
      blowInput.value = '';
      picker.reset();
      error.textContent = '';
      refresh();
      if (count >= MAX_MEASUREMENTS_PER_POINT) {
        navigate(`/points/${pointId}`);
        return;
      }
      blowInput.focus();
    } catch (e) {
      showError(error, e);
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  };

  const saveButton = h('button', { type: 'button', class: 'btn btn-primary btn-save', onclick: () => void save() }, '保存して次へ');
  keepFocusOnPress(saveButton);

  const form = h('form', { class: 'measure-form', novalidate: true },
    h('div', { class: 'measure-depth' },
      h('div', { class: 'depth-label' }, '現在深度'),
      depthValue,
      counter,
      lastSaved,
    ),
    h('label', { class: 'field-label', for: 'blow-count' }, '打撃回数'),
    blowInput,
    h('div', { class: 'field-label' }, '今回貫入量'),
    ...picker.elements,
    error,
  );
  // 端末キーボードの「完了／確定」でも保存
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });
  refresh();

  return screen({
    title: name,
    backHref: `#/points/${pointId}`,
    backLabel: `${name} 地点画面`,
    body: [form],
    footer: [nextDepth, saveButton],
  });
}
