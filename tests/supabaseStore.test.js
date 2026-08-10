const { createSupabaseStore } = require('../src/store/supabaseStore')
const { createPostgrest, eq } = require('../src/store/postgrest')
const { createApp } = require('../src/app')
const { longText, createTestClock } = require('./helpers')

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * 実際の Supabase に対して読み書きする結合テスト。
 * 資格情報が無い環境（CI やクローン直後）では自動的に飛ばす。
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx jest supabaseStore
 */
const describeIfConfigured = URL && KEY ? describe : describe.skip

describeIfConfigured('Supabase ストア', () => {
  jest.setTimeout(60000)

  const suffix = `test${Date.now()}`
  // describe.skip でも本体は評価されるため、クライアントの生成は beforeAll まで遅らせる。
  let db
  let app

  /** テスト用の ID には目印を付け、後片付けで確実に消せるようにする。 */
  function testIdFactory() {
    let n = 0
    const gen = (prefix) => () => `${prefix}_${suffix}_${(n += 1)}`
    return {
      member: gen('mem'),
      invitation: gen('inv'),
      invitationCode: gen('CODE'),
      document: gen('doc'),
      reaction: gen('rct'),
      match: gen('mtc'),
      message: gen('msg'),
      report: gen('rep'),
      endorsement: gen('end'),
    }
  }

  beforeAll(() => {
    db = createPostgrest({ url: URL, serviceRoleKey: KEY })
    app = createApp({
      clock: createTestClock('2026-06-01T00:00:00.000Z'),
      newId: testIdFactory(),
      store: createSupabaseStore({ url: URL, serviceRoleKey: KEY }),
    })
  })

  afterAll(async () => {
    // 依存の順に消す。members を先に消すと外部キーで落ちる。
    for (const table of ['messages', 'matches', 'reactions', 'documents', 'sessions', 'blocks']) {
      await db.remove(table, `id=like.*${suffix}*`).catch(() => {})
    }
    await db.remove('messages', `id=like.*${suffix}*`).catch(() => {})
    await db.remove('sessions', `token=not.is.null&member_id=like.*${suffix}*`).catch(() => {})
    await db.remove('blocks', `blocker_id=like.*${suffix}*`).catch(() => {})
    await db.remove('invitations', `id=like.*${suffix}*`).catch(() => {})
    await db.remove('members', `id=like.*${suffix}*`).catch(() => {})
  })

  async function activate(email, displayName, gender) {
    const invitation = await app.invitations.issueByOperator({
      operatorId: 'op_integration',
      inviteeName: displayName,
      inviteeEmail: email,
      introduction: longText(`${displayName}の紹介`),
      relationship: 'FRIEND',
    })
    const member = await app.members.register({
      invitationCode: invitation.code,
      email,
      password: 'password-1234',
      displayName,
      birthDate: '1987-07-07',
      gender,
      prefecture: '東京都',
    })
    await app.members.updateProfile(member.id, {
      occupation: '会社員',
      bio: longText('自己紹介'),
      intent: 'MARRIAGE',
      photos: ['no-photo'],
    })
    const doc = await app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'PASSPORT',
      imageRef: 'ref',
      fullName: displayName,
      birthDate: '1987-07-07',
    })
    await app.verification.approve({ documentId: doc.id, reviewerId: 'op_integration' })
    await app.screening.submit(member.id)
    return app.screening.approve({ memberId: member.id, reviewerId: 'op_integration' })
  }

  test('会員の書き込みと読み出しが往復する', async () => {
    const member = await activate(`${suffix}.a@example.test`, '結合テストA', 'FEMALE')
    const reloaded = await app.members.get(member.id)

    expect(reloaded.displayName).toBe('結合テストA')
    expect(reloaded.status).toBe('ACTIVE')
    expect(reloaded.badges.identityVerified).toBe(true)
    expect(reloaded.introduction.text.length).toBeGreaterThanOrEqual(100)
    expect(reloaded.birthDate).toBe('1987-07-07')
  })

  test('招待コードは大文字小文字を無視して引ける', async () => {
    const invitation = await app.invitations.issueByOperator({
      operatorId: 'op_integration',
      inviteeName: '照合',
      inviteeEmail: `${suffix}.lookup@example.test`,
      introduction: longText('照合の紹介'),
    })
    const found = await app.invitations.lookup(invitation.code.toLowerCase())
    expect(found.id).toBe(invitation.id)
  })

  test('相互いいねでマッチし、メッセージが保存される', async () => {
    const a = await activate(`${suffix}.b@example.test`, '結合テストB', 'FEMALE')
    const b = await activate(`${suffix}.c@example.test`, '結合テストC', 'MALE')

    const candidates = await app.matching.discover({ memberId: a.id })
    expect(candidates.map((c) => c.id)).toContain(b.id)

    await app.matching.react({ fromId: a.id, toId: b.id, type: 'LIKE' })
    const { match } = await app.matching.react({ fromId: b.id, toId: a.id, type: 'LIKE' })
    expect(match).not.toBeNull()

    await app.messages.send({ matchId: match.id, senderId: a.id, body: 'よろしくお願いします' })
    const thread = await app.messages.list({ matchId: match.id, memberId: b.id })
    expect(thread.map((m) => m.body)).toEqual(['よろしくお願いします'])

    const matches = await app.matching.listMatches(b.id)
    expect(matches[0].lastMessage.body).toBe('よろしくお願いします')
    expect(matches[0].unreadCount).toBe(1)
  })

  test('セッションが永続化され、別インスタンスからでも認証できる', async () => {
    const member = await activate(`${suffix}.d@example.test`, '結合テストD', 'OTHER')
    const { token } = await app.auth.login({
      email: member.email,
      password: 'password-1234',
    })

    // 別のプロセスを模して、ストアを作り直したアプリから検証する。
    const another = createApp({
      newId: testIdFactory(),
      store: createSupabaseStore({ url: URL, serviceRoleKey: KEY }),
    })
    const authenticated = await another.auth.authenticate(token)
    expect(authenticated.id).toBe(member.id)

    await another.auth.logout(token)
    await expect(another.auth.authenticate(token)).rejects.toThrow('ログインが必要です')
  })

  test('ブロックは双方向に効く', async () => {
    const a = await activate(`${suffix}.e@example.test`, '結合テストE', 'FEMALE')
    const b = await activate(`${suffix}.f@example.test`, '結合テストF', 'MALE')

    await app.safety.block({ blockerId: a.id, blockedId: b.id })
    expect(await app.store.blocks.exists(a.id, b.id)).toBe(true)
    expect(await app.store.blocks.exists(b.id, a.id)).toBe(true)

    const candidates = await app.matching.discover({ memberId: b.id })
    expect(candidates.map((c) => c.id)).not.toContain(a.id)
  })
})
