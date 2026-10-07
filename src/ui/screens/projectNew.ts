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
  // 調査件名（業務の正式名称）。案件名として一覧・見出しにも使い、電子納品データの調査件名にも入れる。
  // 長い名称でも全体が見えるよう複数行の欄にする
  const nameInput = h('textarea', {
    id: 'project-name', class: 'text-input title-input', rows: 3, autocomplete: 'off',
    placeholder: '例：令和○年度 ○○地区地質調査業務委託', enterkeyhint: 'next',
  });
  const countInput = h('input', {
    id: 'point-count', class: 'text-input count-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'off', placeholder: '例：12', enterkeyhint: 'done',
  });
  const error = errorText();
  let saving = false;

  // 業務DB連携：業務番号を入れると調査件名を自動で入れ、発注機関も取得しておく（案件作成時に電子納品データへ入れる）
  const dbEnabled = projectDbAvailable();
  const dbStatus = h('p', { class: 'hint', id: 'db-status', 'aria-live': 'polite' });
  const dbResult = h('div', { class: 'db-result', id: 'db-result' });
  let fetched: ProjectDbRecord | null = null;
  let lookupSeq = 0;
  /** 直前に自動で入れた調査件名。利用者が手で書き換えていなければ、業務番号が変わったとき入れ替える */
  let autoTitle = '';
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
      const current = nameInput.value.trim();
      if (rec.surveyTitle && (current === '' || current === autoTitle)) {
        nameInput.value = rec.surveyTitle;
        autoTitle = rec.surveyTitle;
      }
      renderProjectDbResult(dbResult, rec, appConfig.defaultContractorName, { showSurveyTitle: false });
    } catch (e) {
      if (seq !== lookupSeq) return;
      dbStatus.textContent = `${e instanceof Error ? e.message : String(e)}。電子納品データの項目は、あとで「データ出力・バックアップ」画面から取得・入力できます。`;
    }
  };
  // 入力が止まって少ししたら、または欄を離れたら取得する
  let debounce: ReturnType<typeof setTimeout> | undefined;
  numberInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void lookup(), 800);
  });
  numberInput.addEventListener('change', () => { clearTimeout(debounce); void lookup(); });

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field-label', for: 'project-number' }, '業務番号'),
    numberInput,
    dbEnabled ? dbStatus : null,
    dbEnabled ? dbResult : null,
    h('label', { class: 'field-label', for: 'project-name' }, '調査件名'),
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
      // 業務番号の全角数字は半角にして保存する（業務DBの番号と揃える）
      const project = await repository.createProject(currentNumber(), nameInput.value, count);
      // 電子納品データの標題情報：調査件名はこの欄の値、発注機関は業務DBから取れたときだけ
      const matched = fetched && fetched.projectNumber === currentNumber() ? fetched : null;
      await repository.updateDeliveryInfo(project.id, {
        surveyTitle: project.projectName, clientName: matched?.clientName ?? '',
        contractorName: appConfig.defaultContractorName, testerName: '',
      });
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
