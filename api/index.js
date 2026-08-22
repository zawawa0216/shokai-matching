const { createApp, createStoreFromEnv } = require('../index')
const { createRequestHandler } = require('../src/api/handler')

/**
 * Vercel のサーバーレス関数エントリ。
 * vercel.json の rewrite で /api/* をすべてここに集めている。
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
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(
      JSON.stringify({
        error: {
          code: 'DATABASE_NOT_CONFIGURED',
          message:
            'データベースが未設定です。環境変数 SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。',
        },
      }),
    )
  }
  return handler(req, res)
}
