import { repository } from '../../db/repository';
import { navigate } from '../../router';
import { MAX_POINTS } from '../../domain/types';
import { normalizeDigits } from '../../domain/validation';
import { h } from '../dom';
import { errorText, screen, showError } from '../components/layout';

export async function projectNewScreen(): Promise<HTMLElement> {
  const numberInput = h('input', {
    id: 'project-number', class: 'text-input', type: 'text', autocomplete: 'off',
    placeholder: '例：0540', 'data-autofocus': true, enterkeyhint: 'next',
  });
  const nameInput = h('input', {
    id: 'project-name', class: 'text-input', type: 'text', autocomplete: 'off',
    placeholder: '例：○○地区地質調査', enterkeyhint: 'next',
  });
  const countInput = h('input', {
    id: 'point-count', class: 'text-input count-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', placeholder: '例：12', enterkeyhint: 'done',
  });
  const error = errorText();
  let saving = false;

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field-label', for: 'project-number' }, '業務番号'),
    numberInput,
    h('label', { class: 'field-label', for: 'project-name' }, '案件名'),
    nameInput,
    h('label', { class: 'field-label', for: 'point-count' }, '試験数量（地点数）'),
    h('div', { class: 'count-row' }, countInput, h('span', { class: 'unit' }, '地点')),
    h('p', { class: 'hint' }, `K-1 から順に地点が用意されます（最大 ${MAX_POINTS}）。どの地点からでも記録できます。後から変更もできます。`),
    error,
  );

  const submit = async () => {
    if (saving) return;
    saving = true;
    try {
      const countText = normalizeDigits(countInput.value);
      const count = /^[0-9]+$/.test(countText) ? Number(countText) : NaN;
      const project = await repository.createProject(numberInput.value, nameInput.value, count);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      showError(error, e);
    } finally {
      saving = false;
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });

  return screen({
    title: '新しい案件',
    backHref: '#/',
    backLabel: '案件一覧',
    body: [form],
    footer: [h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => void submit() }, '案件を作成')],
  });
}
