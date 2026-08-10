const { AppError } = require('../errors')

/**
 * Supabase の PostgREST を叩く最小クライアント。
 *
 * supabase-js を入れずに標準の fetch だけで済ませている。
 * サーバーレスでは実行ごとに接続が張り直されるため、
 * コネクションプールを持つドライバより HTTP のほうが素直に動く。
 */
function createPostgrest({ url, serviceRoleKey, fetchImpl = globalThis.fetch }) {
  if (!url) throw new Error('SUPABASE_URL is required')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')

  const base = `${url.replace(/\/$/, '')}/rest/v1`
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  }

  async function request(path, { method = 'GET', body, prefer } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: prefer ? { ...headers, prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    const text = await response.text()
    if (!response.ok) {
      // PostgREST のエラー本文はスキーマ情報を含むため、クライアントには返さない。
      console.error('postgrest error', response.status, path, text)
      throw new AppError('STORAGE_ERROR', 'データの読み書きに失敗しました', 500)
    }
    return text ? JSON.parse(text) : null
  }

  return {
    async select(table, query = '') {
      return request(`/${table}?${query}`)
    },

    async selectOne(table, query = '') {
      const rows = await request(`/${table}?${query}&limit=1`)
      return rows && rows.length ? rows[0] : undefined
    },

    /** 主キー衝突時は上書きする。サービス層の save() がこの意味論を前提にしている。 */
    async upsert(table, row) {
      const rows = await request(`/${table}`, {
        method: 'POST',
        body: row,
        prefer: 'resolution=merge-duplicates,return=representation',
      })
      return rows && rows.length ? rows[0] : row
    },

    async remove(table, query) {
      await request(`/${table}?${query}`, { method: 'DELETE' })
    },
  }
}

/** PostgREST のフィルタ値に含まれる予約文字を安全に渡す。 */
function eq(column, value) {
  return `${column}=eq.${encodeURIComponent(value)}`
}

module.exports = { createPostgrest, eq }
