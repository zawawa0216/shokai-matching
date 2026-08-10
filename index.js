const { createApp } = require('./src/app')
const { createMemoryStore } = require('./src/store/memoryStore')
const { createSupabaseStore } = require('./src/store/supabaseStore')
const { createHttpServer } = require('./src/api/httpServer')
const { createRequestHandler } = require('./src/api/handler')
const constants = require('./src/domain/constants')
const errors = require('./src/errors')

/**
 * 環境変数が揃っていれば Supabase、なければインメモリで動かす。
 * ローカルで気軽に触れるようにしつつ、本番では必ず永続化するための分岐。
 */
function createStoreFromEnv(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStore({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    })
  }
  return createMemoryStore()
}

module.exports = {
  createApp,
  createStoreFromEnv,
  createMemoryStore,
  createSupabaseStore,
  createHttpServer,
  createRequestHandler,
  constants,
  errors,
}
