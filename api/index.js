const { createApp, createStoreFromEnv } = require('../index')
const { createRequestHandler } = require('../src/api/handler')

/**
 * Vercel のサーバーレス関数エントリ。/api/* をすべてここで受ける。
 * ハンドラはローカルの node:http サーバーと同じものを使う。
 *
 * モジュールスコープで組み立てることで、ウォームスタート時は初期化を省ける。
 */
/** 実行環境が自動で入れる変数。診断ではこれらを除いて数える。 */
const SYSTEM_ENV =
  /^(VERCEL|AWS|NODE|LAMBDA|npm|_|PATH$|HOME$|PWD$|SHLVL$|LANG|LC_|TZ$|TERM$|HOSTNAME$|PORT$|INIT_CWD$|EDITOR$|USER$|SHELL$|COLOR|CI$)/

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
            // 実行環境が自前で入れる変数を除いた「人が設定した変数」の名前。
            // 名前の打ち間違いをここで見つけられる。値は決して返さない。
            customNames: Object.keys(process.env)
              .filter((name) => !SYSTEM_ENV.test(name))
              .sort(),
          },
        },
      }),
    )
  }
  return handler(req, res)
}
