const {
  createTestApp,
  seedActiveMember,
  seedInvitation,
  longText,
  OPERATOR_ID,
} = require('./helpers')
const { REACTION } = require('../src/domain/constants')

describe('マッチング', () => {
  let app
  let alice
  let bob

  beforeEach(async () => {
    ;({ app } = createTestApp())
    alice = await seedActiveMember(app, {
      email: 'alice@example.com',
      displayName: 'あきこ',
      gender: 'FEMALE',
      prefecture: '東京都',
    })
    bob = await seedActiveMember(app, {
      email: 'bob@example.com',
      displayName: 'ぼぶ',
      gender: 'MALE',
      prefecture: '東京都',
      birthDate: '1985-08-08',
    })
  })

  test('審査を通っていない会員は相手を探せない', async () => {
    const invitation = await seedInvitation(app)
    const pending = await app.members.register({
      invitationCode: invitation.code,
      email: invitation.inviteeEmail,
      password: 'password-1234',
      displayName: '審査中',
      birthDate: '1990-02-02',
      gender: 'MALE',
      prefecture: '東京都',
    })
    await expect(app.matching.discover({ memberId: pending.id })).rejects.toThrow('審査通過後')
  })

  test('候補一覧には自分と審査中の会員が含まれない', async () => {
    const candidates = await app.matching.discover({ memberId: alice.id })
    expect(candidates.map((c) => c.id)).toEqual([bob.id])
  })

  test('候補プロフィールには紹介文が必ず含まれる', async () => {
    const [candidate] = await app.matching.discover({ memberId: alice.id })
    expect(candidate.introduction.text.length).toBeGreaterThanOrEqual(100)
    expect(candidate.introduction.authorRole).toBe('OPERATOR')
    expect(candidate).not.toHaveProperty('email')
    expect(candidate).not.toHaveProperty('credentials')
  })

  test('相互にいいねするとマッチが成立する', async () => {
    const first = await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    expect(first.match).toBeNull()

    const second = await app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.LIKE })
    expect(second.match).not.toBeNull()
    expect(second.match.memberIds).toEqual(expect.arrayContaining([alice.id, bob.id]))

    expect(await app.matching.listMatches(alice.id)).toHaveLength(1)
    expect((await app.matching.listMatches(bob.id))[0].partner.id).toBe(alice.id)
  })

  test('見送りではマッチしない', async () => {
    await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    const result = await app.matching.react({
      fromId: bob.id,
      toId: alice.id,
      type: REACTION.PASS,
    })
    expect(result.match).toBeNull()
    expect(await app.matching.listMatches(alice.id)).toHaveLength(0)
  })

  test('同じ相手に二度リアクションできない', async () => {
    await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    await expect(
      app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.PASS }),
    ).rejects.toThrow('既にリアクション済み')
  })

  test('リアクション済みの相手は候補に出ない', async () => {
    await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.PASS })
    expect(await app.matching.discover({ memberId: alice.id })).toHaveLength(0)
  })

  test('自分宛の未返信のいいねを取得できる', async () => {
    await app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.LIKE })
    const incoming = await app.matching.listIncomingLikes(alice.id)
    expect(incoming).toHaveLength(1)
    expect(incoming[0].member.id).toBe(bob.id)

    await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    expect(await app.matching.listIncomingLikes(alice.id)).toHaveLength(0)
  })

  test('条件で候補を絞り込める', async () => {
    const carol = await seedActiveMember(app, {
      email: 'carol@example.com',
      displayName: 'きゃろる',
      gender: 'FEMALE',
      prefecture: '大阪府',
      birthDate: '1980-04-04',
    })

    const byPrefecture = await app.matching.discover({
      memberId: alice.id,
      filters: { prefecture: '大阪府' },
    })
    expect(byPrefecture.map((c) => c.id)).toEqual([carol.id])

    const byGender = await app.matching.discover({
      memberId: alice.id,
      filters: { gender: 'MALE' },
    })
    expect(byGender.map((c) => c.id)).toEqual([bob.id])

    const byAge = await app.matching.discover({ memberId: alice.id, filters: { maxAge: 40 } })
    expect(byAge.map((c) => c.id)).toEqual([bob.id])
  })

  test('30歳未満での絞り込みは受け付けない', async () => {
    await expect(
      app.matching.discover({ memberId: alice.id, filters: { minAge: 25 } }),
    ).rejects.toThrow('minAge')
  })

  test('独身証明済みの会員が候補の上位に来る', async () => {
    const certified = await seedActiveMember(app, {
      email: 'certified@example.com',
      displayName: 'しょうめい',
      gender: 'MALE',
      singleCertified: true,
    })
    const candidates = await app.matching.discover({ memberId: alice.id })
    expect(candidates[0].id).toBe(certified.id)
    expect(candidates[0].badges.singleCertified).toBe(true)
  })
})

describe('メッセージ', () => {
  let app
  let alice
  let bob
  let matchId

  beforeEach(async () => {
    ;({ app } = createTestApp())
    alice = await seedActiveMember(app, { email: 'alice2@example.com', displayName: 'あきこ' })
    bob = await seedActiveMember(app, {
      email: 'bob2@example.com',
      displayName: 'ぼぶ',
      gender: 'MALE',
    })
    await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    const result = await app.matching.react({
      fromId: bob.id,
      toId: alice.id,
      type: REACTION.LIKE,
    })
    matchId = result.match.id
  })

  test('マッチした相手とはメッセージをやり取りできる', async () => {
    await app.messages.send({ matchId, senderId: alice.id, body: 'はじめまして' })
    await app.messages.send({ matchId, senderId: bob.id, body: 'こちらこそ' })

    const thread = await app.messages.list({ matchId, memberId: alice.id })
    expect(thread.map((m) => m.body)).toEqual(['はじめまして', 'こちらこそ'])
  })

  test('マッチしていない第三者はスレッドを読めない', async () => {
    const carol = await seedActiveMember(app, { email: 'carol2@example.com' })
    await expect(app.messages.list({ matchId, memberId: carol.id })).rejects.toThrow(
      'マッチが見つかりません',
    )
  })

  test('マッチしていない相手には送れない', async () => {
    const carol = await seedActiveMember(app, { email: 'carol3@example.com' })
    await expect(
      app.messages.send({ matchId: 'mtc_unknown', senderId: carol.id, body: 'こんにちは' }),
    ).rejects.toThrow('マッチが見つかりません')
  })

  test('マッチ解消後はメッセージを送れない', async () => {
    await app.matching.unmatch({ matchId, memberId: alice.id })
    await expect(
      app.messages.send({ matchId, senderId: bob.id, body: 'まだ話したい' }),
    ).rejects.toThrow('終了しています')
  })

  test('既読をつけられる', async () => {
    await app.messages.send({ matchId, senderId: bob.id, body: 'おはようございます' })
    const read = await app.messages.markRead({ matchId, memberId: alice.id })
    expect(read).toHaveLength(1)
    expect(read[0].readAt).not.toBeNull()
  })

  test('マッチ一覧に最後のメッセージと未読数が出る', async () => {
    await app.messages.send({ matchId, senderId: bob.id, body: 'こんばんは' })
    const [entry] = await app.matching.listMatches(alice.id)
    expect(entry.lastMessage.body).toBe('こんばんは')
    expect(entry.unreadCount).toBe(1)
  })
})

describe('ブロックと通報', () => {
  let app
  let alice
  let bob

  beforeEach(async () => {
    ;({ app } = createTestApp())
    alice = await seedActiveMember(app, { email: 'alice3@example.com' })
    bob = await seedActiveMember(app, { email: 'bob3@example.com', gender: 'MALE' })
  })

  test('ブロックするとマッチが終了し、相手は候補から消える', async () => {
    await app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    const { match } = await app.matching.react({
      fromId: bob.id,
      toId: alice.id,
      type: REACTION.LIKE,
    })

    await app.safety.block({ blockerId: alice.id, blockedId: bob.id })

    expect((await app.store.matches.find(match.id)).status).toBe('CLOSED')
    expect(await app.matching.listMatches(alice.id)).toHaveLength(0)
    const bobsCandidates = await app.matching.discover({ memberId: bob.id })
    expect(bobsCandidates.map((c) => c.id)).not.toContain(alice.id)
    await expect(
      app.messages.send({ matchId: match.id, senderId: bob.id, body: 'やあ' }),
    ).rejects.toThrow()
  })

  test('通報には紹介者が記録される', async () => {
    const referred = await seedActiveMember(app, {
      email: 'referred@example.com',
      referrerId: alice.id,
      gender: 'MALE',
    })
    const report = await app.safety.report({
      reporterId: bob.id,
      targetId: referred.id,
      reason: 'BUSINESS_SOLICITATION',
      detail: '投資の勧誘を受けました',
    })

    expect(report.targetReferrerId).toBe(alice.id)
    expect(await app.safety.listReports({ status: 'OPEN' })).toHaveLength(1)

    await app.safety.resolveReport({
      reportId: report.id,
      reviewerId: OPERATOR_ID,
      resolution: '対象会員を利用停止',
    })
    expect(await app.safety.listReports({ status: 'OPEN' })).toHaveLength(0)
  })

  test('推薦文はアクティブ会員だけが書け、重複投稿できない', async () => {
    await app.members.addEndorsement({
      memberId: bob.id,
      authorId: alice.id,
      text: longText('推薦'),
    })
    expect((await app.members.get(bob.id)).endorsements).toHaveLength(1)

    await expect(
      app.members.addEndorsement({
        memberId: bob.id,
        authorId: alice.id,
        text: longText('再推薦'),
      }),
    ).rejects.toThrow('既にこの会員へ推薦文')

    await expect(
      app.members.addEndorsement({ memberId: bob.id, authorId: bob.id, text: longText('自薦') }),
    ).rejects.toThrow('自分自身')
  })
})
