const { createApp, createStoreFromEnv } = require('../index')
const { createRequestHandler } = require('../src/api/handler')

/**
 * Vercel のサーバーレス関数エントリ。/api/* をすべてここで受ける。
 * ハンドラはローカルの node:http サーバーと同じものを使う。
 *
 * モジュールスコープで組み立てることで、ウォームスタート時は初期化を省ける。
 */
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

let handler = null
if (configured) {
  const app = createApp({ store: createStoreFromEnv() })
  handler = createRequestHandler({ app })
}

module.exports = (req, res) => {
  if (!handler) {
    // サーバーレスでは実行ごとにプロセスが変わるため、
    // 永続化が未設定のまま動かすとログインすら保持できない。黙って壊れるより止める。
    //
    // 設定漏れの切り分け用に、値ではなく「見えている変数名」と環境の種別だけ添える。
    // 名前は秘密ではなく、この状態ではアプリは何も提供していない。
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(
      JSON.stringify({
        error: {
          code: 'DATABASE_NOT_CONFIGURED',
          message:
            'データベースが未設定です。環境変数 SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。',
          diagnostics: {
            vercelEnv: process.env.VERCEL_ENV || null,
            visibleNames: Object.keys(process.env)
              .filter((name) => /SUPABASE|OPERATOR/i.test(name))
              .sort(),
          },
        },
      }),
    )
  }
  return handler(req, res)
}
