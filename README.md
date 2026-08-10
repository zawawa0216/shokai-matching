# 紹介制マッチングアプリ

知人の紹介がなければ登録できないクローズドなマッチングサービスのバックエンドです。
「誰が、どんな言葉で紹介したか」を必ずプロフィールに添えることで、
不特定多数に開かれたアプリとは違う信頼の担保を狙っています。

## 4つの必須要件

| 要件 | 実装 |
| --- | --- |
| 紹介制 | 有効な招待コードを消費しなければ会員を作れない（`memberService.register` が唯一の生成経路） |
| 紹介文の必須化 | 招待発行時に100文字以上の紹介文を要求。本人は編集不可で、候補一覧にも常に表示される |
| 身分証必須 | 本人確認書類が承認されるまで入会審査に進めない。年齢の根拠は自己申告ではなく書類の生年月日 |
| 独身証明書は任意 | 未提出でも入会できる。承認されるとバッジが付き、発行から90日で自動的に失効する |
| 30歳以上 | 登録時に自己申告で、書類承認時に記載の生年月日で再判定。誕生日当日に加齢する |

## 会員のライフサイクル

```
招待発行（紹介文つき）
   └─ 登録 → PENDING_PROFILE
        ├─ プロフィール入力（職業・自己紹介100文字以上・目的・写真）
        ├─ 本人確認書類の提出 → 運営が承認
        └─ 独身証明書の提出（任意）
      → 審査申請 → PENDING_SCREENING → 運営が承認 → ACTIVE
                                          └ 却下 → REJECTED
ACTIVE ─ 相手探し / いいね / 相互マッチ / メッセージ / 他の人を紹介
   ├─ 通報・ブロック → 運営判断で SUSPENDED
   └─ 退会 → WITHDRAWN
```

ACTIVE の会員だけが相手を探せて、相手を紹介できます。

## 使い方

```bash
npm install
npm test                            # 69 tests
OPERATOR_KEY=secret npm start       # http://localhost:3000
npm run build:demo                  # dist/demo.html（ブラウザだけで動く体験版）
```

`OPERATOR_KEY` を設定しないと `/admin/*` は 503 を返します。

## 体験版

`npm run build:demo` は `dist/demo.html` を書き出します。サーバーもデータベースも要らず、
ブラウザで開くだけで紹介の発行から入会審査、マッチングまで一通り試せます。

このページには `src/` のサービス実装がそのまま入っています（`tools/build-demo.js` が
CommonJS モジュールを小さなローダで包んで単体ファイルにまとめます）。デモ用にロジックを
書き写していないので、招待の期限も年齢の判定もサーバーと同じコードが動きます。
違いは2点だけです。

- データベースの代わりにブラウザのメモリを使うため、再読み込みで消える
- パスワードのハッシュはブラウザ用の簡易版に差し替えてある（本番の scrypt とは別物）

`tests/demoBundle.test.js` がバンドルを実際に評価して、ブラウザ環境でも
入会条件とマッチングの規則が壊れていないことを検証します。

## 主なエンドポイント

認証は `Authorization: Bearer <token>`、運営操作は `x-operator-key` ヘッダを使います。

**公開**

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/auth/login` | ログイン |
| GET | `/invitations/:code` | 招待コードの確認（紹介者と紹介文を表示） |
| POST | `/members/register` | 招待コードを使って登録 |

**会員**

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET / PATCH | `/me` | プロフィールの取得・更新 |
| GET / POST | `/me/screening` | 入会条件の充足状況 / 審査申請 |
| POST | `/me/documents/identity` | 本人確認書類の提出（必須） |
| POST | `/me/documents/single-status` | 独身証明書の提出（任意） |
| GET / POST | `/me/invitations` | 自分が発行した招待の一覧 / 新規発行 |
| DELETE | `/me/invitations/:id` | 招待の取り消し |
| GET | `/discover` | 候補一覧（`minAge` `maxAge` `gender` `prefecture` `intent` `singleCertifiedOnly`） |
| GET | `/members/:id` | 相手のプロフィール |
| POST | `/members/:id/like` `/pass` | いいね / 見送り |
| POST | `/members/:id/endorsements` | 他の会員への推薦文 |
| GET | `/likes/incoming` | 自分宛の未返信のいいね |
| GET | `/matches` | マッチ一覧 |
| GET / POST | `/matches/:id/messages` | メッセージ |
| POST | `/blocks` `/reports` | ブロック / 通報 |

**運営**

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/admin/invitations` | 運営発行の招待（立ち上げ期の初期会員用） |
| GET | `/admin/documents` | 審査待ちの書類 |
| POST | `/admin/documents/:id/approve` `/reject` | 書類審査 |
| GET | `/admin/screenings` | 審査待ちの会員 |
| POST | `/admin/members/:id/approve` `/reject` `/suspend` | 入会審査・利用停止 |
| GET | `/admin/reports` | 通報一覧 |

## 構成

```
index.js                    ライブラリとしてのエクスポート
server.js                   HTTP サーバーの起動
src/
  app.js                    合成ルート（clock と ID 生成をここだけで注入）
  store.js                  インメモリのデータストア
  support.js                clock / ID / 招待コード生成
  errors.js                 AppError とサブクラス
  domain/constants.js       年齢・文字数・有効期限などの閾値
  domain/dates.js           UTC 固定の日付・年齢計算
  domain/validators.js      入力バリデーション
  services/                 招待・会員・本人確認・審査・マッチング・メッセージ・安全
  api/                      ルーター、ルート定義、node:http サーバー
demo/index.html             体験版の画面（<!--BUNDLE--> にバンドルが差し込まれる）
tools/build-demo.js         src/ をブラウザ用に束ねる最小バンドラ
tools/build-artifact.js     体験版を単一 HTML として書き出す
tests/                      Jest テスト（ドメイン + API 疎通 + バンドル）
```

外部ランタイム依存はありません（Node 20+ の標準ライブラリのみ）。
データストアと認証セッションはインメモリなので、プロセスを落とすと消えます。
本番では同じインターフェースの RDB / セッションストア実装に差し替える前提です。

## 現在の設定値

`src/domain/constants.js` にまとめてあります。

| 項目 | 既定値 |
| --- | --- |
| 最低年齢 | 30歳 |
| 紹介文の文字数 | 100〜2000文字 |
| 自己紹介文の下限 | 100文字 |
| 招待コードの有効期限 | 14日 |
| 同時に持てる未使用招待 | 3件 |
| 独身証明書の有効期間 | 発行から90日 |
| 本人確認書類の種別 | 運転免許証・パスポート・マイナンバーカード・在留カード |

## 未確定事項

以下はこちらで既定値を置いて実装しました。方針が決まり次第、`constants.js` の変更か
サービス層の追加で対応できます。

1. **課金モデル** — 現状すべて無料。月額制／いいね数の従量制／紹介者への還元などは未実装。
2. **年齢の上限と男女比の調整** — 上限なし・比率調整なしで実装。
3. **紹介の連鎖の制限** — 誰でも紹介できる（ACTIVE であれば）。「入会3ヶ月後から」「紹介した相手が通報されたら紹介権を停止」などの制限は未実装。
4. **本人確認のやり方** — 現状は画像の参照キーを預かって運営が目視で承認する前提。eKYC 事業者との連携は未実装。
5. **写真とマスキング** — 写真は文字列の参照キーのみ。実ファイルの保存・顔検出・審査は未実装。
6. **独身証明書のインセンティブ** — バッジ表示と候補一覧での優先のみ。「証明済み会員だけを見る」モードは絞り込みとして実装済み。
7. **退会と個人情報の削除** — `WITHDRAWN` に変えるだけで、書類・メッセージの物理削除やリテンション期間は未実装。
8. **通知** — メール／プッシュ通知は未実装。
