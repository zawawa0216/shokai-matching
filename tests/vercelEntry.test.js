const http = require('node:http')

/**
 * Vercel のサーバーレス関数エントリの検証。
 * デプロイして初めて壊れていることに気づく類の場所なので、ここで固めておく。
 */
function loadEntry(env) {
  jest.resetModules()
  const saved = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  Object.assign(process.env, env)
  for (const key of Object.keys(saved)) {
    if (env[key] === undefined) delete process.env[key]
  }
  const handler = require('../api/[...path].js')
  Object.assign(process.env, saved)
  return handler
}

async function withServer(handler, fn) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

describe('Vercel エントリ', () => {
  test('永続化が未設定なら 503 で理由を返す', async () => {
    const handler = loadEntry({})
    const result = await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/health`)
      return { status: response.status, body: await response.json() }
    })

    expect(result.status).toBe(503)
    expect(result.body.error.code).toBe('DATABASE_NOT_CONFIGURED')
  })

  test('設定済みならリクエストを API ハンドラに渡す', async () => {
    const handler = loadEntry({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-key',
    })

    const result = await withServer(handler, async (base) => {
      const response = await fetch(`${base}/api/health`)
      return { status: response.status, body: await response.json() }
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
  })

  test('catch-all でもパスがそのままルーターに届く', async () => {
    const handler = loadEntry({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-key',
    })

    const result = await withServer(handler, async (base) => {
      // 認証必須のパス。ルーティングが効いていれば 401、外れていれば 404 になる。
      const response = await fetch(`${base}/api/me`)
      return { status: response.status, body: await response.json() }
    })

    expect(result.status).toBe(401)
    expect(result.body.error.code).toBe('UNAUTHENTICATED')
  })
})
