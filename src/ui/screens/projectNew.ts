import { repository } from '../../db/repository';
import { navigate } from '../../router';
import { MAX_POINTS } from '../../domain/types';
import { normalizeDigits } from '../../domain/validation';
import { h } from '../dom';
import { errorText, screen, showError } from '../components/layout';
import { renderProjectDbResult } from '../components/projectDbResult';
import { fetchProjectRecord, getApiKey, projectDbAvailable, type ProjectDbRecord } from '../../api/projectDb';
import { appConfig } from '../../config';

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

  // 業務DB連携：業務番号を入れると調査件名・発注機関を取得しておき、案件作成時に電子納品データへ入れる
  const dbEnabled = projectDbAvailable();
  const dbStatus = h('p', { class: 'hint', id: 'db-status', 'aria-live': 'polite' });
  const dbResult = h('div', { class: 'db-result', id: 'db-result' });
  let fetched: ProjectDbRecord | null = null;
  let lookupSeq = 0;
  const currentNumber = () => normalizeDigits(numberInput.value).trim();
  const lookup = async () => {
    const number = currentNumber();
    if (fetched && fetched.projectNumber === number) return;
    fetched = null;
    renderProjectDbResult(dbResult, null, '');
    dbStatus.textContent = '';
    if (!dbEnabled || !number) return;
    if (!getApiKey()) {
      dbStatus.textContent = '業務DBのキーが未設定のため自動入力しません（案件一覧 →「業務DB連携の設定」）。';
      return;
    }
    const seq = ++lookupSeq;
    dbStatus.textContent = '業務DBを確認しています…';
    try {
      const rec = await fetchProjectRecord(number);
      if (seq !== lookupSeq || currentNumber() !== number) return;
      fetched = rec;
      dbStatus.textContent = '';
      renderProjectDbResult(dbResult, rec, appConfig.defaultContractorName);
    } catch (e) {
      if (seq !== lookupSeq) return;
      dbStatus.textContent = `${e instanceof Error ? e.message : String(e)}。電子納品データの項目は、あとで「データ出力・バックアップ」画面から取得・入力できます。`;
    }
  };
  numberInput.addEventListener('change', () => void lookup());

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field-label', for: 'project-number' }, '業務番号'),
    numberInput,
    dbEnabled ? dbStatus : null,
    dbEnabled ? dbResult : null,
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
      if (fetched && fetched.projectNumber === currentNumber()) {
        await repository.updateDeliveryInfo(project.id, {
          surveyTitle: fetched.surveyTitle, clientName: fetched.clientName,
          contractorName: appConfig.defaultContractorName, testerName: '',
        });
      }
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
