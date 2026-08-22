# AGENTS.md

このファイルはリポジトリで作業するAIエージェント向けのガイドラインです。

## プロジェクト概要

紹介制マッチングアプリ。Supabase(Postgres) に永続化し、Vercel で動かします。
実行時の外部依存パッケージはなく、Node.js 標準ライブラリと Jest だけで構成しています。
仕様とデプロイ手順は `README.md` を参照。

## リポジトリ構成

```
public/             フロントエンド（ビルド不要の素の HTML/CSS/JS）
api/[...path].js    Vercel のサーバーレス関数エントリ
server.js           ローカル用サーバー
src/app.js          合成ルート
src/store/          memoryStore / supabaseStore / postgrest
src/domain/         定数・日付計算・バリデーション
src/services/       招待・会員・本人確認・審査・マッチング・メッセージ・安全
src/api/            ルーター・ルート定義・ハンドラ
scripts/seed.js     稼働中の API に初期会員を投入
tests/              Jest テスト
```

## 開発コマンド

```bash
npm install
npm test                          # 全テストの実行
npx jest tests/matching.test.js   # 単一ファイル
OPERATOR_KEY=devkey npm start     # ローカル起動（http://localhost:3000）
npm run seed -- --base http://localhost:3000 --operator-key devkey
```

Supabase 実装を検証するときだけ、資格情報を渡して結合テストを走らせる。

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx jest supabaseStore
```

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
- **サービス層のメソッドはすべて async。** ストアは Promise を返す前提で、`await` を落とさない
- 現在時刻は必ず注入された `clock()` から取る。`new Date()` を直接呼ばない
- ID と招待コードの生成は `newId` 経由。サービス内で `crypto` を直接使わない
- 日付は `src/domain/dates.js` の UTC 前提のヘルパーを使う（タイムゾーンで年齢が1日ずれるため）
- 閾値（年齢・文字数・有効期限）はハードコードせず `src/domain/constants.js` に置く
- エラーは `src/errors.js` の `AppError` サブクラスを投げる。API 層が `code` と `status` をそのまま返す
- 利用者向けのメッセージは日本語で書く

## ストア層の注意

- `memoryStore` と `supabaseStore` は同じインターフェースを実装する。
  片方にメソッドを足したら必ずもう片方にも足す
- snake_case ↔ camelCase の対応は `supabaseStore.js` の mapper に集約する。
  サービス層に列名を漏らさない
- 新しいテーブルを足すときは RLS を有効にし、ポリシーは置かない
  （サーバーのサービスロール以外からアクセスさせない）
- スキーマ変更は Supabase のマイグレーションとして適用し、README の表も更新する

## API 層の注意

- ハンドラの戻り値は既定で 200。ステータスを変えるときは `respond(status, body)` を使う
  （ドメインオブジェクトも `status` を持つため、プロパティの有無で判定してはいけない）
- 他会員に返すプロフィールは `matchingService.toPublicProfile` を通す。
  メールアドレスと `credentials` を素で返さない
- ルートのパスは `/api/` から始める。`vercel.json` の rewrite と `server.js` の振り分けが前提にしている
- Vercel では `/api/*` を `api/index.js` に集約し、元のパスを `__path` クエリで渡している。
  ファイル名の動的ルートに戻さない（多階層のパスが関数に届かず 404 になる）

## フロントエンドの注意

- ビルドステップを増やさない。`public/` の3ファイルで完結させる
- ルールの判定を JS 側に複製しない。文字数カウンタのような表示上の補助は良いが、
  可否の最終判断は必ず API のエラーに従う
- スワイプカードは `touch-action: pan-y`。縦スクロールは端末に任せ、横だけ JS で扱う

## テストのガイドライン

- 変更後は必ず `npm test` を実行する
- 非同期になったので、失敗の検証は `await expect(...).rejects.toThrow()` を使う
- 時間に依存する検証（招待の期限、独身証明書の失効、誕生日）は `tests/helpers.js` の
  `createTestClock` で時刻を進める。実時間に依存させない
- 会員を用意するときは `seedActiveMember` / `seedInvitation` を使う
- 境界値を必ず含める（誕生日の前日・当日、有効期限の当日・翌日、文字数の下限）
- パラメータ化テストには `test.each` を優先使用

## エージェントへの注意事項

- 外部ランタイム依存パッケージはユーザーに確認してから追加する
- 個人情報（身分証の画像参照・生年月日・メールアドレス）をログやエラーメッセージに含めない
- 認証情報は `authService` の外に出さない。パスワードを平文で保持・返却しない
- サービスロールキーをリポジトリに書かない。環境変数だけで受け取る
