// ハッシュ方式の最小ルーター。GitHub Pages のような静的ホスティングでもそのまま動く。

export type Params = Record<string, string>;
export type ScreenRenderer = (params: Params) => Promise<HTMLElement>;

interface Route {
  pattern: RegExp;
  keys: string[];
  render: ScreenRenderer;
}

const routes: Route[] = [];

/** "/points/:pointId/measure" の形でルートを登録する */
export function route(path: string, render: ScreenRenderer): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    }) + '$',
  );
  routes.push({ pattern, keys, render });
}

export function navigate(path: string): void {
  if (location.hash === `#${path}`) {
    void renderCurrent();
  } else {
    location.hash = path;
  }
}

let root: HTMLElement;
let renderToken = 0;

export function startRouter(container: HTMLElement): void {
  root = container;
  window.addEventListener('hashchange', () => void renderCurrent());
  void renderCurrent();
}

async function renderCurrent(): Promise<void> {
  const token = ++renderToken;
  const path = location.hash.replace(/^#/, '') || '/';
  const match = routes
    .map((r) => ({ r, m: r.pattern.exec(path) }))
    .find((x) => x.m !== null);
  if (!match || !match.m) {
    location.replace('#/');
    return;
  }
  const params: Params = {};
  match.r.keys.forEach((key, i) => (params[key] = decodeURIComponent(match.m![i + 1])));
  try {
    const element = await match.r.render(params);
    if (token !== renderToken) return; // 描画中に別の画面へ移動した
    root.replaceChildren(element);
    window.scrollTo(0, 0);
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  } catch (error) {
    if (token !== renderToken) return;
    const message = error instanceof Error ? error.message : String(error);
    const box = document.createElement('div');
    box.className = 'fatal';
    box.innerHTML = '<p></p><a class="btn btn-secondary" href="#/">案件一覧へ</a>';
    box.querySelector('p')!.textContent = message;
    root.replaceChildren(box);
  }
}
