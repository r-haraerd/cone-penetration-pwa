import { h } from '../dom';

export interface ConfirmOptions {
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * 確認ダイアログ。取り消しボタンを上、実行ボタンを下に離して置き、誤タップを防ぐ。
 * 戻り値は実行が選ばれたとき true。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'confirm-dialog' });
    const close = (result: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.append(
      h('p', { class: 'confirm-message' }, options.message),
      options.detail ? h('p', { class: 'confirm-detail' }, options.detail) : '',
      h('div', { class: 'confirm-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close(false) }, options.cancelLabel ?? 'キャンセル'),
        h('button', {
          type: 'button',
          class: `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`,
          onclick: () => close(true),
        }, options.confirmLabel),
      ),
    );
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
