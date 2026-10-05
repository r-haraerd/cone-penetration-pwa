import { parsePenetrationCm, type Result } from '../../domain/validation';
import { h, keepFocusOnPress } from '../dom';

type Mode = '10' | '5' | 'other';

export interface PenetrationPicker {
  /** 画面に置く要素（ボタン群と「その他」入力欄） */
  elements: HTMLElement[];
  /** 選択中の貫入量。「その他」が未入力・不正なら null（次深度の表示用） */
  current(): number | null;
  /** 保存時の検証 */
  read(): Result<number>;
  /** 初期値（10 cm）に戻す */
  reset(): void;
  focusOther(): void;
}

/** 今回貫入量の選択： [10 cm] [5 cm] [その他]（任意の cm を入力） */
export function penetrationPicker(initialCm: number, onChange: () => void): PenetrationPicker {
  let mode: Mode = initialCm === 10 ? '10' : initialCm === 5 ? '5' : 'other';

  const otherInput = h('input', {
    id: 'other-cm', class: 'number-input small', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'その他の貫入量 cm',
    value: mode === 'other' ? String(initialCm) : '',
  });
  const otherRow = h('div', { class: 'other-row' }, otherInput, h('span', { class: 'unit' }, 'cm'));
  const buttons: Record<Mode, HTMLButtonElement> = {
    '10': h('button', { type: 'button', class: 'seg-btn', 'data-mode': '10' }, '10 cm'),
    '5': h('button', { type: 'button', class: 'seg-btn', 'data-mode': '5' }, '5 cm'),
    other: h('button', { type: 'button', class: 'seg-btn', 'data-mode': 'other' }, 'その他'),
  };
  const group = h('div', { class: 'seg-group', role: 'group', 'aria-label': '今回貫入量' },
    buttons['10'], buttons['5'], buttons.other);

  const render = () => {
    for (const [key, button] of Object.entries(buttons)) {
      const selected = key === mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    otherRow.hidden = mode !== 'other';
  };

  const select = (next: Mode) => {
    mode = next;
    render();
    if (next === 'other') otherInput.focus();
    onChange();
  };
  buttons['10'].addEventListener('click', () => select('10'));
  buttons['5'].addEventListener('click', () => select('5'));
  buttons.other.addEventListener('click', () => select('other'));
  // 10 cm / 5 cm を押しても打撃回数の数字キーボードを閉じない
  keepFocusOnPress(buttons['10']);
  keepFocusOnPress(buttons['5']);
  otherInput.addEventListener('input', onChange);
  render();

  return {
    elements: [group, otherRow],
    current() {
      if (mode === '10') return 10;
      if (mode === '5') return 5;
      const r = parsePenetrationCm(otherInput.value);
      return r.ok ? r.value : null;
    },
    read() {
      if (mode === '10') return { ok: true, value: 10 };
      if (mode === '5') return { ok: true, value: 5 };
      return parsePenetrationCm(otherInput.value);
    },
    reset() {
      mode = '10';
      otherInput.value = '';
      render();
    },
    focusOther() {
      otherInput.focus();
    },
  };
}
