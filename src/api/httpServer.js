const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createRequestHandler } = require('./handler')

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public')

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * ローカル開発用のサーバー。
 * /api/* は API ハンドラへ、それ以外は public/ の静的ファイルへ振り分ける。
 * 本番の Vercel では同じ役割を vercel.json のルーティングが担う。
 */
function createHttpServer({ app, operatorKey } = {}) {
  const api = createRequestHandler({ app, operatorKey })

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const requested = url.pathname === '/' ? '/index.html' : url.pathname
    const resolved = path.join(PUBLIC_DIR, path.normalize(requested))

    // public/ の外へ出るパスは拒否する。
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403)
      return res.end()
    }

    fs.readFile(resolved, (error, content) => {
      if (error) {
        // 未知のパスは SPA のエントリに寄せる。
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackError, html) => {
          if (fallbackError) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            return res.end('not found')
          }
          res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] })
          res.end(html)
        })
      }
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream',
      })
      res.end(content)
    })
  }

  return http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return api(req, res)
    return serveStatic(req, res)
  })
}

module.exports = { createHttpServer }
