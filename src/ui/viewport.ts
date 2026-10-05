/**
 * ソフトウェアキーボードの高さを CSS 変数 --kb に反映する。
 * iPhone の数字キーボードには「完了」キーがないため、キーボードを開いたまま
 * 画面下部の「保存して次へ」を押せるよう、フッターをキーボードの上へ持ち上げる。
 * （Android は viewport の interactive-widget=resizes-content で画面自体が縮むため 0 になる）
 */
export function watchKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(inset)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
