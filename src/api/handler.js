const crypto = require('node:crypto')
const { buildRoutes } = require('./routes')
const { isResponse } = require('./response')
const { AppError } = require('../errors')

const MAX_BODY_BYTES = 1024 * 1024

function readJsonBody(req) {
  // Vercel など一部の実行環境は先にボディをパースして req.body に載せてくる。
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return Promise.resolve(parseJson(req.body))
    }
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return Promise.resolve(req.body)
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new AppError('PAYLOAD_TOO_LARGE', 'リクエストが大きすぎます', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(parseJson(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function parseJson(raw) {
  const text = String(raw).trim()
  if (!text) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AppError('INVALID_JSON', 'リクエストボディの JSON が不正です', 400)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('INVALID_JSON', 'JSON オブジェクトを送信してください', 400)
  }
  return parsed
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/**
 * フレームワークに依存しない JSON API ハンドラ。
 * node:http のサーバーからも Vercel の関数からも同じものを使う。
 *
 * 認証は Authorization: Bearer <token>、運営操作は x-operator-key ヘッダで行う。
 */
function createRequestHandler({ app, operatorKey = process.env.OPERATOR_KEY } = {}) {
  const { router } = buildRoutes(app)

  async function resolve(req) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    // Vercel では /api/* をまとめてこの関数へ書き換えているため、
    // req.url は書き換え後のパスになる。元のパスは __path で渡ってくる。
    const forwarded = url.searchParams.get('__path')
    url.searchParams.delete('__path')
    const pathname = forwarded || url.pathname

    const matched = router.match(req.method, pathname)
    if (!matched) {
      throw new AppError('NOT_FOUND', 'エンドポイントが見つかりません', 404)
    }

    const { route, params } = matched
    const context = {
      params,
      query: Object.fromEntries(url.searchParams.entries()),
      body: ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {},
      headers: req.headers,
    }

    if (route.options.auth === 'member') {
      const header = req.headers.authorization || ''
      context.token = header.startsWith('Bearer ') ? header.slice(7) : null
      context.member = await app.auth.authenticate(context.token)
    }

    if (route.options.auth === 'operator') {
      if (!operatorKey) {
        throw new AppError('OPERATOR_KEY_NOT_CONFIGURED', '運営用APIが未設定です', 503)
      }
      if (!constantTimeEquals(req.headers['x-operator-key'] || '', operatorKey)) {
        throw new AppError('UNAUTHENTICATED', '運営キーが不正です', 401)
      }
      context.operatorId = String(req.headers['x-operator-id'] || 'operator')
    }

    const result = await route.handler(context)
    return isResponse(result) ? { status: result.status, body: result.body } : { status: 200, body: result }
  }

  function send(res, status, body) {
    if (status === 204 || body === undefined) {
      res.writeHead(204)
      res.end()
      return
    }
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    })
    res.end(payload)
  }

  return async function handle(req, res) {
    try {
      const { status, body } = await resolve(req)
      send(res, status, body)
    } catch (error) {
      const known = error instanceof AppError
      if (!known) {
        // 想定外の例外は内部情報を返さず、サーバー側にだけ残す。
        console.error(error)
      }
      send(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'サーバーエラーが発生しました',
          details: known ? error.details : undefined,
        },
      })
    }
  }
}

module.exports = { createRequestHandler }
