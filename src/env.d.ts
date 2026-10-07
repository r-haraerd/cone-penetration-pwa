/** ビルド時に vite.config.ts の define で埋め込まれる */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 業務データベース参照 API のベース URL（GitHub のリポジトリ変数 PROJECT_API_BASE から。未設定なら連携なし） */
  readonly VITE_PROJECT_API_BASE?: string;
  /** 電子納品の「調査業者名」の既定値（リポジトリ変数 DEFAULT_CONTRACTOR から） */
  readonly VITE_DEFAULT_CONTRACTOR?: string;
}
