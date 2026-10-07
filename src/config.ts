/**
 * ビルド時に埋め込む設定。
 *
 * 公開リポジトリのソースに社名や社内 API の URL を書かないよう、値は GitHub のリポジトリ変数
 * （Settings → Secrets and variables → Actions → Variables）から公開ワークフローで渡す。
 * 手元で試すときは .env.local（コミットしない）に VITE_PROJECT_API_BASE / VITE_DEFAULT_CONTRACTOR を書く。
 *
 * API キーはここに置かない。端末ごとに「業務DB連携の設定」画面で入力し、その端末だけに保存する。
 */
export const appConfig = {
  projectApiBase: (import.meta.env.VITE_PROJECT_API_BASE ?? '').trim().replace(/\/+$/, ''),
  defaultContractorName: (import.meta.env.VITE_DEFAULT_CONTRACTOR ?? '').trim(),
};
