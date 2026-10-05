import { registerSW } from 'virtual:pwa-register';
import { h } from './dom';

/**
 * Service Worker の登録と、新しいバージョンがあるときの知らせ。
 * 自動では再読み込みしない。測定データは保存のたびに IndexedDB へ書き込まれているため、
 * 「更新」を押しても入力済みのデータは失われない（入力途中の数字だけは消える）。
 */
export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateBar(() => void updateSW(true));
    },
  });
}

function showUpdateBar(onUpdate: () => void): void {
  if (document.querySelector('.update-bar')) return;
  const bar = h('div', { class: 'update-bar', role: 'status' },
    h('span', {}, '新しいバージョンがあります'),
    h('button', { type: 'button', class: 'update-btn', onclick: onUpdate }, '更新'),
    h('button', { type: 'button', class: 'update-later', onclick: () => bar.remove(), 'aria-label': 'あとで' }, 'あとで'),
  );
  document.body.append(bar);
}

// ---------------------------------------------------------------------------
// ホーム画面への追加（インストール）
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Android / PC の Chrome が出す「インストール可能」イベントを保持しておく */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    document.querySelectorAll<HTMLElement>('[data-install-button]').forEach((b) => (b.hidden = false));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.querySelectorAll('.install-hint').forEach((el) => el.remove());
  });
}

/** ホーム画面から起動しているか */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
}

/**
 * ブラウザで開いているときに出す案内。
 * iPhone/iPad は、ホーム画面に追加していないサイトのデータを一定期間使わないと
 * 消すことがあるため、必ずホーム画面から使ってもらう。
 */
export function installHint(): HTMLElement | null {
  if (isStandalone()) return null;
  const installButton = h('button', {
    type: 'button', class: 'btn btn-secondary', 'data-install-button': true, hidden: deferredPrompt === null,
    onclick: async () => {
      if (!deferredPrompt) return;
      await deferredPrompt.prompt();
      deferredPrompt = null;
    },
  }, 'ホーム画面に追加（インストール）');
  return h('section', { class: 'install-hint' },
    h('p', { class: 'install-title' }, 'ホーム画面に追加して使ってください'),
    h('p', { class: 'hint' },
      isIos()
        ? 'Safari の共有ボタン（□に↑）→「ホーム画面に追加」。ホーム画面から開くと圏外でも起動でき、データが消えにくくなります。'
        : 'ブラウザのメニュー →「アプリをインストール」または「ホーム画面に追加」。ホーム画面から開くと圏外でも起動できます。'),
    installButton,
  );
}
