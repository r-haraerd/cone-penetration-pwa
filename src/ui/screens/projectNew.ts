import { repository } from '../../db/repository';
import { navigate } from '../../router';
import { h } from '../dom';
import { errorText, screen, showError } from '../components/layout';

export async function projectNewScreen(): Promise<HTMLElement> {
  const numberInput = h('input', {
    id: 'project-number', class: 'text-input', type: 'text', autocomplete: 'off',
    placeholder: '例：0540', 'data-autofocus': true, enterkeyhint: 'next',
  });
  const nameInput = h('input', {
    id: 'project-name', class: 'text-input', type: 'text', autocomplete: 'off',
    placeholder: '例：○○地区地質調査', enterkeyhint: 'done',
  });
  const error = errorText();
  let saving = false;

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field-label', for: 'project-number' }, '業務番号'),
    numberInput,
    h('label', { class: 'field-label', for: 'project-name' }, '案件名'),
    nameInput,
    error,
  );

  const submit = async () => {
    if (saving) return;
    saving = true;
    try {
      const project = await repository.createProject(numberInput.value, nameInput.value);
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
