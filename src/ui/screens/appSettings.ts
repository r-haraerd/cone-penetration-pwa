import { getApiKey, projectDbAvailable, setApiKey, testConnection } from '../../api/projectDb';
import { appConfig } from '../../config';
import { h } from '../dom';
import { errorText, screen, showError } from '../components/layout';

/**
 * 業務DB連携の設定（端末ごと）。
 * API キーはこの端末の中だけに保存し、案件データ・バックアップ・CSV には含めない。
 */
export async function appSettingsScreen(): Promise<HTMLElement> {
  const available = projectDbAvailable();
  const keyInput = h('input', {
    id: 'api-key', class: 'text-input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    placeholder: '発行された API キー', value: getApiKey(),
  });
  const show = h('input', { id: 'api-key-show', type: 'checkbox', onchange: () => { keyInput.type = show.checked ? 'text' : 'password'; } });
  const error = errorText();
  const message = h('p', { class: 'result-text', 'aria-live': 'polite' });
  const status = h('p', { class: 'hint', id: 'api-key-status' });
  const refreshStatus = () => { status.textContent = getApiKey() ? 'この端末にキーが保存されています。' : 'キーは未設定です。'; };
  refreshStatus();

  const save = async (test: boolean) => {
    error.textContent = '';
    message.textContent = '';
    try {
      setApiKey(keyInput.value);
      refreshStatus();
      if (!getApiKey()) { message.textContent = 'キーを削除しました'; return; }
      if (!test) { message.textContent = '保存しました'; return; }
      message.textContent = '接続を確認しています…';
      await testConnection();
      message.textContent = '保存しました。業務DBに接続できました。';
    } catch (e) {
      message.textContent = '';
      showError(error, e);
    }
  };

  const body = available
    ? [
        h('section', { class: 'card' },
          h('h2', { class: 'card-heading' }, '業務DB連携'),
          h('p', { class: 'hint' }, '業務番号から、電子納品データの「調査件名」「発注機関名称」を業務データベースから自動で入れます。使うには、発行された API キーをこの端末に保存してください。'),
          h('label', { class: 'field-label', for: 'api-key' }, 'API キー'),
          keyInput,
          h('label', { class: 'check-label', for: 'api-key-show' }, show, ' キーを表示する'),
          status,
          h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'save-test', onclick: () => void save(true) }, '保存して接続を確認'),
          h('button', { type: 'button', class: 'btn btn-secondary', 'data-action': 'clear', onclick: () => { keyInput.value = ''; void save(false); } }, 'この端末からキーを削除'),
          error,
          message,
        ),
        h('section', { class: 'card' },
          h('h2', { class: 'card-heading' }, 'キーの取り扱い'),
          h('p', { class: 'hint' }, 'キーがあれば全業務の情報を読めます。キーはこの端末の中だけに保存され、バックアップや CSV には含まれません。共用端末や手放す端末では「この端末からキーを削除」を押してください。'),
          appConfig.defaultContractorName ? h('p', { class: 'hint' }, `調査業者名の既定値：${appConfig.defaultContractorName}`) : null,
        ),
      ]
    : [h('p', { class: 'notice' }, 'このアプリでは業務DB連携が設定されていません。電子納品データの項目は手入力してください。')];

  return screen({ title: '業務DB連携の設定', backHref: '#/', backLabel: '案件一覧', body });
}
