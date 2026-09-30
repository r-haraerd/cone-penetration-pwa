import { h, type Child } from '../dom';

export interface ScreenLayout {
  title: string;
  /** 戻り先のハッシュ（例 "#/"）。なければ戻るボタンを出さない */
  backHref?: string;
  backLabel?: string;
  /** null / false / '' は表示しない */
  body: Child[];
  /** 画面下部（親指で押しやすい位置）に固定する主要操作 */
  footer?: Node[];
}

export function screen(layout: ScreenLayout): HTMLElement {
  return h('div', { class: 'screen' },
    h('header', { class: 'app-header' },
      layout.backHref
        ? h('a', { class: 'back-link', href: layout.backHref }, `‹ ${layout.backLabel ?? '戻る'}`)
        : h('span', { class: 'back-link placeholder' }),
      h('h1', { class: 'app-title' }, layout.title),
      networkBadge(),
    ),
    h('main', { class: 'app-main' }, ...layout.body),
    layout.footer && layout.footer.length > 0 ? h('footer', { class: 'app-footer' }, ...layout.footer) : null,
  );
}

/** ヘッダー右端の小さなオンライン／オフライン表示 */
function networkBadge(): HTMLElement {
  const badge = h('span', { class: 'net-badge', 'aria-live': 'polite' });
  updateBadge(badge);
  return badge;
}

function updateBadge(badge: HTMLElement): void {
  const online = navigator.onLine;
  badge.textContent = online ? '● オンライン' : '● オフライン';
  badge.classList.toggle('offline', !online);
}

// 画面を描き直すたびにリスナーを増やさないよう、登録は 1 回だけ
const updateAllBadges = () => document.querySelectorAll<HTMLElement>('.net-badge').forEach(updateBadge);
window.addEventListener('online', updateAllBadges);
window.addEventListener('offline', updateAllBadges);

export function errorText(): HTMLElement {
  return h('p', { class: 'error-text', role: 'alert' });
}

export function showError(target: HTMLElement, error: unknown): void {
  target.textContent = error instanceof Error ? error.message : String(error);
}
