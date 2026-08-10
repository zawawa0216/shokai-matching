# AGENTS.md

このファイルはリポジトリで作業するAIエージェント向けのガイドラインです。

## プロジェクト概要

紹介制マッチングアプリのバックエンドです。外部ランタイム依存はなく、
Node.js 標準ライブラリと Jest だけで構成しています。仕様の全体像は `README.md` を参照。

## リポジトリ構成

```
index.js            # ライブラリとしてのエクスポート（createApp / createHttpServer）
server.js           # HTTP サーバーの起動
src/app.js          # 合成ルート
src/store.js        # インメモリのデータストア
src/domain/         # 定数・日付計算・バリデーション
src/services/       # 招待・会員・本人確認・審査・マッチング・メッセージ・安全
src/api/            # ルーター・ルート定義・node:http サーバー
demo/index.html     # 体験版の画面
tools/              # 体験版のビルド（src/ をブラウザ用に束ねる）
tests/              # Jest テスト
```

## 開発コマンド

```bash
npm install
npm test                          # 全テストの実行
npx jest tests/matching.test.js   # 単一ファイル
OPERATOR_KEY=secret npm start     # ローカル起動
npm run build:demo                # dist/demo.html を書き出す
```

## 体験版について

`demo/index.html` は UI だけを持ち、ドメインロジックは `src/` のコードを
`tools/build-demo.js` が束ねたものをそのまま読み込む。

- **デモ側にルールを書き写さない。** 年齢や文字数の判定を UI に複製すると本体と乖離する
- 新しいサービスを `src/services/` に足したら `tools/build-demo.js` の `ENTRIES` にも追加する
- ブラウザ用の `node:crypto` スタブは `tools/build-demo.js` の `PRELUDE` にあり、
  パスワードハッシュはデモ専用の簡易実装。本番の認証に使わない
- 体験版の初期データも実サービス経由で作るため、規約（自己紹介100文字など）を
  満たさない文面を書くと起動時に落ちる。変更したら `npm test` で確認する

## 崩してはいけない不変条件

これらはプロダクトの根幹なので、変更する前に必ずユーザーに確認すること。

- **会員は招待からしか生まれない。** `memberService.register` 以外に会員を作る経路を増やさない。
- **紹介文は必ず存在する。** 招待発行時に100文字以上を要求し、本人は編集できない。
  `updateProfile` で `introduction` を書き換えられるようにしない。
- **本人確認書類の承認なしに `ACTIVE` にしない。** 審査条件は `screeningService.requirements` に集約する。
- **年齢の根拠は本人確認書類。** 自己申告値だけで30歳以上を確定させない。
- **独身証明書は任意。** 入会の必須条件（`checks`）に加えない。
- **メッセージはマッチ成立後のみ。** `matchingService.getMatchFor` を経由しない送信経路を作らない。

## コード規約

- CommonJS モジュール形式（`require` / `module.exports`）。TypeScript・ビルドステップなし
- サービスは `createXxxService({ store, clock, newId, ... })` の形のファクトリ関数で書く
- 現在時刻は必ず注入された `clock()` から取る。`new Date()` を直接呼ばない
- ID と招待コードの生成は `newId` 経由。サービス内で `crypto` を直接使わない
- 日付は `src/domain/dates.js` の UTC 前提のヘルパーを使う（タイムゾーンで年齢が1日ずれるため）
- 閾値（年齢・文字数・有効期限）はハードコードせず `src/domain/constants.js` に置く
- エラーは `src/errors.js` の `AppError` サブクラスを投げる。API 層が `code` と `status` をそのまま返す
- 利用者向けのメッセージは日本語で書く

## API 層の注意

- ハンドラの戻り値は既定で 200。ステータスを変えるときは `respond(status, body)` を使う
  （ドメインオブジェクトも `status` を持つため、プロパティの有無で判定してはいけない）
- 他会員に返すプロフィールは `matchingService.toPublicProfile` を通す。
  メールアドレスと `credentials` を素で返さない

## テストのガイドライン

- 変更後は必ず `npm test` を実行する
- 時間に依存する検証（招待の期限、独身証明書の失効、誕生日）は `tests/helpers.js` の
  `createTestClock` で時刻を進める。実時間に依存させない
- 会員を用意するときは `seedActiveMember` / `seedInvitation` を使う
- 境界値を必ず含める（誕生日の前日・当日、有効期限の当日・翌日、文字数の下限）
- パラメータ化テストには `test.each` を優先使用

## エージェントへの注意事項

- 外部ランタイム依存パッケージはユーザーに確認してから追加する
- 個人情報（身分証の画像参照・生年月日・メールアドレス）をログやエラーメッセージに含めない
- 認証情報は `authService` の外に出さない。パスワードを平文で保持・返却しない
