const { AppError } = require('../errors')

/**
 * 依存ゼロの小さなルーター。
 * '/matches/:id/messages' のようなパターンを登録順に照合する。
 */
function createRouter() {
  const routes = []

  function compile(pattern) {
    const names = []
    const source = pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment
        names.push(segment.slice(1))
        return '([^/]+)'
      })
      .join('/')
    return { regexp: new RegExp(`^${source}$`), names }
  }

  return {
    add(method, pattern, handler, options = {}) {
      const { regexp, names } = compile(pattern)
      routes.push({ method, regexp, names, handler, options })
      return this
    },
    get(pattern, handler, options) {
      return this.add('GET', pattern, handler, options)
    },
    post(pattern, handler, options) {
      return this.add('POST', pattern, handler, options)
    },
    patch(pattern, handler, options) {
      return this.add('PATCH', pattern, handler, options)
    },
    delete(pattern, handler, options) {
      return this.add('DELETE', pattern, handler, options)
    },
    match(method, pathname) {
      let pathMatched = false
      for (const route of routes) {
        const found = route.regexp.exec(pathname)
        if (!found) continue
        pathMatched = true
        if (route.method !== method) continue
        const params = {}
        route.names.forEach((name, index) => {
          params[name] = decodeURIComponent(found[index + 1])
        })
        return { route, params }
      }
      if (pathMatched) {
        throw new AppError('METHOD_NOT_ALLOWED', 'このパスでは使用できないメソッドです', 405)
      }
      return null
    },
  }
}

module.exports = { createRouter }
