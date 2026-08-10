const { createApp, createHttpServer } = require('./index')

const port = Number(process.env.PORT || 3000)
const app = createApp()
const server = createHttpServer({ app })

server.listen(port, () => {
  console.log(`matching api listening on http://localhost:${port}`)
  if (!process.env.OPERATOR_KEY) {
    console.warn('OPERATOR_KEY が未設定のため /admin/* は 503 を返します')
  }
})
