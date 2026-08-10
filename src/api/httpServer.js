const http = require('node:http')
const crypto = require('node:crypto')
const { buildRoutes } = require('./routes')
const { isResponse } = require('./response')
const { AppError } = require('../errors')

const MAX_BODY_BYTES = 1024 * 1024

function readJsonBody(req) {
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
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new AppError('INVALID_JSON', 'JSON オブジェクトを送信してください', 400))
        }
        return resolve(parsed)
      } catch {
        return reject(new AppError('INVALID_JSON', 'リクエストボディの JSON が不正です', 400))
      }
    })
    req.on('error', reject)
  })
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/**
 * node:http のみで動く JSON API。
 * 認証は Authorization: Bearer <token>、運営操作は x-operator-key ヘッダで行う。
 */
function createHttpServer({ app, operatorKey = process.env.OPERATOR_KEY } = {}) {
  const { router } = buildRoutes(app)

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const matched = router.match(req.method, url.pathname)
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
      const token = header.startsWith('Bearer ') ? header.slice(7) : null
      context.token = token
      context.member = app.auth.authenticate(token)
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

  const server = http.createServer((req, res) => {
    handle(req, res)
      .then(({ status, body }) => {
        if (status === 204 || body === undefined) {
          res.writeHead(204)
          return res.end()
        }
        const payload = JSON.stringify(body)
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
        })
        return res.end(payload)
      })
      .catch((error) => {
        const isKnown = error instanceof AppError
        if (!isKnown) {
          // 想定外の例外は内部情報を返さず、サーバー側にだけ残す。
          console.error(error)
        }
        const status = isKnown ? error.status : 500
        const payload = JSON.stringify({
          error: {
            code: isKnown ? error.code : 'INTERNAL_ERROR',
            message: isKnown ? error.message : 'サーバーエラーが発生しました',
            details: isKnown ? error.details : undefined,
          },
        })
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
        })
        res.end(payload)
      })
  })

  return server
}

module.exports = { createHttpServer }
