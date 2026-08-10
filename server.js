const { createApp, createStoreFromEnv, createHttpServer } = require('./index')

const port = Number(process.env.PORT || 3000)
const store = createStoreFromEnv()
const app = createApp({ store })
const server = createHttpServer({ app })

server.listen(port, () => {
  const backend = process.env.SUPABASE_URL ? 'Supabase' : 'メモリ（再起動で消えます）'
  console.log(`matching app listening on http://localhost:${port}  [store: ${backend}]`)
  if (!process.env.OPERATOR_KEY) {
    console.warn('OPERATOR_KEY が未設定のため /api/admin/* は 503 を返します')
  }
})
