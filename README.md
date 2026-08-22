# 紹介制マッチングアプリ

知人の紹介がなければ登録できないクローズドなマッチングサービスです。
「誰が、どんな言葉で紹介したか」を必ずプロフィールに添えることで、
不特定多数に開かれたアプリとは違う信頼の担保を狙っています。

スワイプで相手を探し、相互にいいねするとマッチしてメッセージができます。

**公開先: https://shokai-matching.vercel.app**

動作確認用に4名の会員を投入してあります（`minato@example.com` など、パスワードは
`scripts/seed.js` の既定値）。実運用に移すときは、この会員と共有パスワードを消してください。

## 満たしている要件

| 要件 | 実装 |
| --- | --- |
| 紹介制 | 有効な招待コードを消費しなければ会員を作れない（`memberService.register` が唯一の生成経路） |
| 紹介文の必須化 | 招待発行時に100文字以上の紹介文を要求。本人は編集不可で、スワイプ画面にも常に表示される |
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
ACTIVE ─ スワイプ / 相互マッチ / メッセージ / 他の人を紹介
   ├─ 通報・ブロック → 運営判断で SUSPENDED
   └─ 退会 → WITHDRAWN
```

## 構成

```
public/               フロントエンド（ビルド不要の素の HTML/CSS/JS）
api/index.js          Vercel のサーバーレス関数エントリ（/api/* を集約）
server.js             ローカル用サーバー（/api と public/ を両方さばく）
index.js              ライブラリとしてのエクスポート
src/
  app.js              合成ルート（clock・ID 生成・ストアをここだけで注入）
  store/
    memoryStore.js    インメモリ実装（テストとローカル）
    supabaseStore.js  Supabase(Postgres) 実装
    postgrest.js      fetch だけで動く最小 PostgREST クライアント
  domain/             年齢・文字数・有効期限などの閾値と検証
  services/           招待・会員・本人確認・審査・マッチング・メッセージ・安全
  api/                ルーター、ルート定義、フレームワーク非依存のハンドラ
scripts/seed.js       稼働中の API に初期会員を投入する
tests/                Jest テスト
```

実行時の外部依存パッケージはありません（Node 20+ の標準ライブラリのみ）。
Supabase へのアクセスも `fetch` で PostgREST を直接叩いています。

## ローカルで動かす

```bash
npm install
npm test                                              # 73 tests
OPERATOR_KEY=devkey npm start                         # http://localhost:3000
npm run seed -- --base http://localhost:3000 --operator-key devkey
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を設定するとそちらを使い、
未設定ならインメモリで動きます（再起動で消えます）。

シード後は `minato@example.com` などのアドレスと、表示されるパスワードでログインできます。

## デプロイ（Vercel + Supabase）

`master` への push で自動デプロイされます。Vercel のプロジェクト設定に環境変数を
3つ入れておく必要があり、未設定のままだと `/api/*` は 503 を返し、画面には
設定手順が表示されます（サーバーレスではプロセスが毎回変わるため、
永続化なしでは動かないため）。

`/api/*` は `vercel.json` の rewrite で `api/index.js` にまとめて渡しています。
ファイル名による動的ルート（`api/[...path].js`）は多階層のパスを関数へ届けられず、
`/api/admin/documents` などが 404 になったため、この形にしています。
書き換えで失われる元のパスは `__path` クエリで渡し、ハンドラがそれを見てルーティングします。

| 環境変数 | 内容 |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co`（このプロジェクトでは `wtnozlplahswvobrgjwj`） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase の Project Settings → API Keys のサービスロールキー |
| `OPERATOR_KEY` | 運営用 API の合言葉。任意の長い文字列 |

データベースのテーブルは全て RLS を有効にし、ポリシーを一つも置いていません。
つまりサーバー（サービスロール）以外からは読み書きできず、
公開鍵が漏れても直接アクセスされることはありません。

デプロイ後の初期会員は同じシードスクリプトで入れられます。

```bash
npm run seed -- --base https://<your-app>.vercel.app --operator-key <OPERATOR_KEY>
```

## API

認証は `Authorization: Bearer <token>`、運営操作は `x-operator-key` ヘッダを使います。

**公開**

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 稼働確認 |
| POST | `/api/auth/login` | ログイン |
| GET | `/api/invitations/:code` | 招待コードの確認（紹介者と紹介文を表示） |
| POST | `/api/members/register` | 招待コードを使って登録 |

**会員**

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET / PATCH | `/api/me` | プロフィールの取得・更新 |
| GET / POST | `/api/me/screening` | 入会条件の充足状況 / 審査申請 |
| POST | `/api/me/documents/identity` | 本人確認書類の提出（必須） |
| POST | `/api/me/documents/single-status` | 独身証明書の提出（任意） |
| GET / POST | `/api/me/invitations` | 発行した招待の一覧 / 新規発行 |
| DELETE | `/api/me/invitations/:id` | 招待の取り消し |
| GET | `/api/discover` | スワイプ候補（`minAge` `maxAge` `gender` `prefecture` `intent` `singleCertifiedOnly`） |
| GET | `/api/members/:id` | 相手のプロフィール |
| POST | `/api/members/:id/like` `/pass` | いいね / 見送り |
| POST | `/api/members/:id/endorsements` | 他の会員への推薦文 |
| GET | `/api/likes/incoming` | 自分宛の未返信のいいね |
| GET | `/api/matches` | マッチ一覧（最後のメッセージと未読数つき） |
| GET / POST | `/api/matches/:id/messages` | メッセージ（GET で既読になる） |
| POST | `/api/blocks` `/api/reports` | ブロック / 通報 |

**運営**

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/api/admin/invitations` | 運営発行の招待（立ち上げ期の初期会員用） |
| GET | `/api/admin/documents` | 審査待ちの書類 |
| POST | `/api/admin/documents/:id/approve` `/reject` | 書類審査 |
| GET | `/api/admin/screenings` | 審査待ちの会員 |
| POST | `/api/admin/members/:id/approve` `/reject` `/suspend` | 入会審査・利用停止 |
| GET | `/api/admin/reports` | 通報一覧 |

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
| セッションの有効期間 | 30日 |
| 本人確認書類の種別 | 運転免許証・パスポート・マイナンバーカード・在留カード |

## まだ作っていないもの

1. **運営用の管理画面** — 審査は `/api/admin/*` を直接叩く必要がある。
2. **写真のアップロード** — 現状は URL を貼る方式。Supabase Storage への保存と審査は未実装。
3. **本人確認の自動化** — 画像の参照だけ預かって運営が目視で承認する前提。eKYC 連携は未実装。
4. **課金** — すべて無料。
5. **通知** — メール・プッシュともに未実装。招待コードは発行者が自分で相手に渡す。
6. **退会時の物理削除** — ステータスを変えるだけで、書類やメッセージのリテンション処理はない。
7. **年齢の上限と男女比の調整** — 上限なし・調整なし。
8. **紹介の連鎖の制限** — ACTIVE なら誰でもすぐ紹介できる。
