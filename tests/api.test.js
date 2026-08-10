const { createHttpServer } = require('../src/api/httpServer')
const { createTestApp, seedActiveMember, longText, OPERATOR_ID } = require('./helpers')

const OPERATOR_KEY = 'test-operator-key'

describe('HTTP API', () => {
  let app
  let server
  let baseUrl

  beforeEach(async () => {
    ;({ app } = createTestApp())
    server = createHttpServer({ app, operatorKey: OPERATOR_KEY })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  async function call(method, path, { body, token, operator } = {}) {
    const headers = {}
    if (body) headers['content-type'] = 'application/json'
    if (token) headers.authorization = `Bearer ${token}`
    if (operator) {
      headers['x-operator-key'] = OPERATOR_KEY
      headers['x-operator-id'] = OPERATOR_ID
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function loginAs(member, password = 'password-1234') {
    const res = await call('POST', '/auth/login', { body: { email: member.email, password } })
    return res.body.token
  }

  test('ログインしていないと保護されたエンドポイントは401', async () => {
    const res = await call('GET', '/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('パスワードが違えばログインできず、理由も明かさない', async () => {
    const member = seedActiveMember(app, { email: 'login@example.com' })
    const res = await call('POST', '/auth/login', {
      body: { email: member.email, password: 'wrong-password-x' },
    })
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('メールアドレスまたはパスワードが違います')
  })

  test('存在しないエンドポイントは404、非対応メソッドは405', async () => {
    expect((await call('GET', '/nope')).status).toBe(404)
    expect((await call('PATCH', '/auth/login')).status).toBe(405)
  })

  test('運営キーがなければ /admin/* は使えない', async () => {
    expect((await call('GET', '/admin/documents')).status).toBe(401)
    expect((await call('GET', '/admin/documents', { operator: true })).status).toBe(200)
  })

  test('招待の発行から入会審査、マッチまで一通り動く', async () => {
    const referrer = seedActiveMember(app, {
      email: 'referrer-api@example.com',
      displayName: 'しょうかいしゃ',
      gender: 'MALE',
    })
    const referrerToken = await loginAs(referrer)

    // 1. 紹介文つきで招待を発行する
    const issued = await call('POST', '/me/invitations', {
      token: referrerToken,
      body: {
        inviteeName: 'あたらしい人',
        inviteeEmail: 'newcomer@example.com',
        introduction: longText('あたらしい人の紹介'),
        relationship: 'FRIEND',
      },
    })
    expect(issued.status).toBe(201)

    // 2. 招待コードから紹介文を確認できる
    const looked = await call('GET', `/invitations/${issued.body.code}`)
    expect(looked.status).toBe(200)
    expect(looked.body.referrer.id).toBe(referrer.id)
    expect(looked.body.introduction.text).toBe(issued.body.introduction.text)

    // 3. 登録
    const registered = await call('POST', '/members/register', {
      body: {
        invitationCode: issued.body.code,
        email: 'newcomer@example.com',
        password: 'password-1234',
        displayName: 'あたらしい人',
        birthDate: '1989-11-11',
        gender: 'FEMALE',
        prefecture: '東京都',
      },
    })
    expect(registered.status).toBe(201)
    expect(registered.body.status).toBe('PENDING_PROFILE')
    expect(registered.body).not.toHaveProperty('credentials')

    const token = await loginAs({ email: 'newcomer@example.com' })

    // 4. プロフィールと本人確認書類
    await call('PATCH', '/me', {
      token,
      body: {
        occupation: '教員',
        bio: longText('自己紹介'),
        intent: 'MARRIAGE',
        photos: ['me.jpg'],
      },
    })
    const doc = await call('POST', '/me/documents/identity', {
      token,
      body: {
        docType: 'PASSPORT',
        imageRef: 'passport.jpg',
        fullName: 'あたらしい人',
        birthDate: '1989-11-11',
      },
    })
    expect(doc.status).toBe(201)

    // 本人確認前は審査に進めない
    expect((await call('POST', '/me/screening', { token })).status).toBe(409)

    await call('POST', `/admin/documents/${doc.body.id}/approve`, { operator: true })

    const requirements = await call('GET', '/me/screening', { token })
    expect(requirements.body.eligible).toBe(true)
    expect(requirements.body.optional.singleStatusCertificate).toBe('NOT_SUBMITTED')

    // 5. 審査申請 → 運営承認
    expect((await call('POST', '/me/screening', { token })).body.status).toBe('PENDING_SCREENING')
    const approved = await call(
      'POST',
      `/admin/members/${registered.body.id}/approve`,
      { operator: true },
    )
    expect(approved.body.status).toBe('ACTIVE')

    // 6. 相手探しと相互いいね
    const discovered = await call('GET', '/discover', { token })
    expect(discovered.body.map((c) => c.id)).toContain(referrer.id)

    await call('POST', `/members/${referrer.id}/like`, { token })
    const mutual = await call('POST', `/members/${registered.body.id}/like`, {
      token: referrerToken,
    })
    expect(mutual.body.match).not.toBeNull()

    // 7. メッセージ
    const matchId = mutual.body.match.id
    const sent = await call('POST', `/matches/${matchId}/messages`, {
      token,
      body: { body: 'よろしくお願いします' },
    })
    expect(sent.status).toBe(201)
    const thread = await call('GET', `/matches/${matchId}/messages`, { token: referrerToken })
    expect(thread.body.map((m) => m.body)).toEqual(['よろしくお願いします'])
  })

  test('30歳未満の登録はAPIでも拒否される', async () => {
    const referrer = seedActiveMember(app, { email: 'referrer-age@example.com' })
    const token = await loginAs(referrer)
    const issued = await call('POST', '/me/invitations', {
      token,
      body: {
        inviteeName: '若者',
        inviteeEmail: 'young@example.com',
        introduction: longText('若者の紹介'),
      },
    })

    const res = await call('POST', '/members/register', {
      body: {
        invitationCode: issued.body.code,
        email: 'young@example.com',
        password: 'password-1234',
        displayName: '若者',
        birthDate: '2000-01-01',
        gender: 'MALE',
        prefecture: '東京都',
      },
    })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('AGE_REQUIREMENT_NOT_MET')
  })

  test('不正なJSONは400を返す', async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ broken',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_JSON')
  })
})
