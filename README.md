# 簡易動的コーン貫入試験 現場入力PWA

山中（圏外）でもスマートフォン・iPadから簡易動的コーン貫入試験の生データ（打撃回数・貫入量）を記録し、
`0540_簡易貫入試験_現場データ取込.xlsm` の「現場データ取込」でExcelへ取り込むためのアプリ。
紙野帳への記録とExcelへの転記を廃止することが目的。

> 現在の実装範囲：**Phase 5** まで。
> - Phase 2：案件作成・地点作成・測定入力・IndexedDB保存
> - Phase 3：測定の修正・削除（以降の累積深度と測定順を自動再計算）、全記録一覧、地点番号の変更、地点の削除
> - Phase 4：Excel取込用CSV出力、JSONバックアップの保存・復元、案件の削除
> - Phase 5：PWA化（ホーム画面に追加・圏外での起動）、新バージョンの知らせ、iPad表示
>
> Phase 6（テスト・エラー処理・データ消失対策の総点検）で README を最終化する。

## インストール（ホーム画面に追加）

**公開URL：https://r-haraerd.github.io/cone-penetration-pwa/**

公開URLをブラウザで開き、ホーム画面に追加する。**必ずホーム画面のアイコンから起動すること。**
iPhone / iPad は、ホーム画面に追加していないサイトのデータを、しばらく使わないと自動で消すことがあるため。

| 端末 | 手順 |
| --- | --- |
| iPhone / iPad | **Safari** で開く → 共有ボタン（□に↑）→「ホーム画面に追加」 |
| Android | **Chrome** で開く → 画面の「ホーム画面に追加（インストール）」ボタン、またはメニュー →「アプリをインストール」 |
| PC（確認・編集用） | Chrome / Edge で開く → アドレスバー右のインストールアイコン |

アプリをブラウザで開いている間は、案件一覧にこの案内が表示される（ホーム画面から起動すると消える）。

## オフライン（圏外）での利用

- **最初の1回だけ電波のある場所で開く**。このときアプリ本体が端末に保存され、以降は圏外でも起動できる。
- 圏外でも、案件・地点の作成、測定の入力・修正・削除、CSV/JSON の保存がすべてできる（画面右上に「● オフライン」と表示）。
- 測定データは「保存して次へ」を押すたびに端末内（IndexedDB）へ保存される。アプリを閉じても、電池が切れても、最後に保存した測定までは残る。
- 新しいバージョンを公開すると、次に電波のある場所で開いたときに「新しいバージョンがあります［更新］」が出る。
  自動では切り替わらないので、測定の区切りで「更新」を押す（保存済みのデータは消えない）。
- 案件一覧の一番下に、使っているバージョンとビルド日時を表示している。

## 公開（GitHub Pages）

geo-tools リポジトリには業務用の Excel ファイルが含まれるため、**この `pwa` フォルダだけを専用のリポジトリ**
（例：`cone-penetration-pwa`）として GitHub に置いて公開する。アプリ自体にはデータは含まれない（データは各端末内のみ）。

1. GitHub で新しいリポジトリを作る（GitHub Pages を無料で使う場合は Public）。
2. この `pwa` フォルダの中身をそのリポジトリのルートに置き、`main` ブランチへ push する。
   自動公開の設定は `.github/workflows/deploy.yml`（GitHub はこの場所だけを読む）。
   geo-tools 側のコピーでは保護の都合で `setup/github-pages-deploy.yml` に置いてあるので、同じ内容を `.github/workflows/deploy.yml` に置く。
3. リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。
4. `deploy.yml` が自動で テスト → ビルド → 公開 を行う。公開URLは
   `https://<ユーザー名>.github.io/<リポジトリ名>/`（Actions の実行結果にも表示される）。
5. 以後、`main` に push するたびに自動で更新される。

`vite.config.ts` の `base: './'` により、リポジトリ名（サブパス）に関係なく動く。

アプリのアイコンは `python3 scripts/make-icons.py`（Pillow が必要）で `public/` に再生成できる。

## 開発環境

- Node.js 20 以上（動作確認は 22）
- 主なライブラリ：Vite（ビルド）、TypeScript、Dexie（IndexedDB）、Vitest（テスト）。UIフレームワークは使わない。

```
npm install      # 初回のみ
npm run dev      # 開発サーバー（http://localhost:5173）。スマホから確認するときは npm run dev -- --host
npm test         # 単体テスト（累積深度・採番・上限など）
npm run build    # 型チェック＋本番ビルド（dist/ に出力）
npm run preview  # dist/ を http://localhost:4173 で確認
npm run e2e      # preview を起動した状態で、スマホ画面の操作テスト（Playwright）
                 # Linux で実行する場合は LANG=C.UTF-8 を指定（日本語ファイル名の確認のため）
```

## Excel 取込用 CSV

案件画面の「データ出力・バックアップ」→「CSV を出力」。
`0540_簡易貫入試験_現場データ取込.xlsm` の「現場データ取込」ボタンでそのまま読み込める。

```
RecordID,PointID,ProjectNumber,PointName,PointNumber,Sequence,BlowCount,PenetrationCm,CumulativeDepthCm,RecordedAt
3f2c…,a91b…,0540,K-1,1,1,5,10,10,2026-09-30 09:10:00
```

- UTF-8（BOM付き）・改行 CRLF。1ファイルに1案件の全地点。`ProjectNumber` は取込マクロでは無視される参考列。
- 途中の地点に記録がない（欠番）など、取込マクロが拒否する状態では出力せず、理由を表示する。
- 取込マクロの検証ロジックを `tests/helpers/fieldDataImportRules.ts` に移植し、出力した CSV が通ることを自動テストしている。
  移植の正しさは、Excel 実機で検証済みの `tests/fixtures/*.csv`（正常1件・異常8件）で確認している。
  **取込マクロを変更したら、このファイルも合わせて更新すること。**

## JSON バックアップ

- 「JSON バックアップを保存」で案件の全データを1ファイルに保存する。スマホ・iPad では共有シートが開くので、
  「ファイルに保存」や Google ドライブ等に保存する。PC ではダウンロードされる。
- 案件一覧の「バックアップから復元」で読み込む。ファイル全体を検証してから書き込むため、壊れたファイルを選んでも端末のデータは変わらない。
  同じ案件が端末にある場合は内容を比較表示し、確認のうえで置き換える。
- 形式は `schemaVersion` で識別する。形式を変えるときは `SCHEMA_VERSION` を上げ、`export/backup.ts` の `migrateToCurrent()` に旧形式からの変換を追加する。

## フォルダ構成

```
src/
  domain/   業務ルール（型・定数、累積深度の再計算、入力値の検証、ID生成）
  db/       IndexedDB（database.ts）と、画面から呼ぶ唯一のデータ窓口（repository.ts）
  ui/       画面（screens/）、共通部品（components/）、スタイル
  export/   Excel取込用CSV（csv.ts）、JSONバックアップ（backup.ts）
  router.ts ハッシュ方式の画面切替（#/projects/... 等）
tests/      単体テスト（Vitest＋fake-indexeddb）
e2e/        スマホ画面の操作テスト（Playwright）。offline.mjs は圏外起動と更新の確認
public/     アイコン（scripts/make-icons.py で生成）
.github/    GitHub Pages への自動公開設定（workflows/deploy.yml）
setup/      上記の控え（geo-tools 側は .github に書き込めないため）
```

## 設計上の約束

- 深度・貫入量は **cm の整数**で保存する。表示時だけ m に換算する。
- 累積深度は利用者に入力させず、`domain/depth.ts` の `recalculatePoint` だけで計算する。
  追加・修正・削除はすべてこの関数を通し、1つのトランザクションで保存する。
- 地点名は `K-番号` を番号から導出する。Excel側が K-1 から欠番なしの連番を前提にしているため。
- ID は UUID。将来 Google Drive 等と同期しても衝突しない。
- 業務ルール（25地点・1地点100測定・測定中の地点は1つ）は `domain/types.ts` の定数と `db/repository.ts` に集約。
- 地点の削除は「測定0件の地点」か「最後の番号の地点」だけ（途中を消すと欠番になり Excel に取り込めないため）。
  番号に欠番があると案件画面に警告を出す。
- 測定の修正は終了済みの地点でも可能。測定の追加は測定中の地点のみ。
- 地層・工区・区間などの地質的整理項目は扱わない（帰社後にExcelで整理する）。
