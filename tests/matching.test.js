const { createTestApp, seedActiveMember, seedInvitation, longText, OPERATOR_ID } = require('./helpers')
const { REACTION } = require('../src/domain/constants')

describe('マッチング', () => {
  let app
  let alice
  let bob

  beforeEach(() => {
    ;({ app } = createTestApp())
    alice = seedActiveMember(app, {
      email: 'alice@example.com',
      displayName: 'あきこ',
      gender: 'FEMALE',
      prefecture: '東京都',
    })
    bob = seedActiveMember(app, {
      email: 'bob@example.com',
      displayName: 'ぼぶ',
      gender: 'MALE',
      prefecture: '東京都',
      birthDate: '1985-08-08',
    })
  })

  test('審査を通っていない会員は相手を探せない', () => {
    const invitation = seedInvitation(app)
    const pending = app.members.register({
      invitationCode: invitation.code,
      email: invitation.inviteeEmail,
      password: 'password-1234',
      displayName: '審査中',
      birthDate: '1990-02-02',
      gender: 'MALE',
      prefecture: '東京都',
    })
    expect(() => app.matching.discover({ memberId: pending.id })).toThrow('審査通過後')
  })

  test('候補一覧には自分と審査中の会員が含まれない', () => {
    const candidates = app.matching.discover({ memberId: alice.id })
    expect(candidates.map((c) => c.id)).toEqual([bob.id])
  })

  test('候補プロフィールには紹介文が必ず含まれる', () => {
    const [candidate] = app.matching.discover({ memberId: alice.id })
    expect(candidate.introduction.text.length).toBeGreaterThanOrEqual(100)
    expect(candidate.introduction.authorRole).toBe('OPERATOR')
    expect(candidate).not.toHaveProperty('email')
    expect(candidate).not.toHaveProperty('credentials')
  })

  test('相互にいいねするとマッチが成立する', () => {
    const first = app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    expect(first.match).toBeNull()

    const second = app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.LIKE })
    expect(second.match).not.toBeNull()
    expect(second.match.memberIds).toEqual(expect.arrayContaining([alice.id, bob.id]))

    expect(app.matching.listMatches(alice.id)).toHaveLength(1)
    expect(app.matching.listMatches(bob.id)[0].partner.id).toBe(alice.id)
  })

  test('見送りではマッチしない', () => {
    app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    const result = app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.PASS })
    expect(result.match).toBeNull()
    expect(app.matching.listMatches(alice.id)).toHaveLength(0)
  })

  test('同じ相手に二度リアクションできない', () => {
    app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    expect(() =>
      app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.PASS }),
    ).toThrow('既にリアクション済み')
  })

  test('リアクション済みの相手は候補に出ない', () => {
    app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.PASS })
    expect(app.matching.discover({ memberId: alice.id })).toHaveLength(0)
  })

  test('自分宛の未返信のいいねを取得できる', () => {
    app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.LIKE })
    const incoming = app.matching.listIncomingLikes(alice.id)
    expect(incoming).toHaveLength(1)
    expect(incoming[0].member.id).toBe(bob.id)

    app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    expect(app.matching.listIncomingLikes(alice.id)).toHaveLength(0)
  })

  test('条件で候補を絞り込める', () => {
    const carol = seedActiveMember(app, {
      email: 'carol@example.com',
      displayName: 'きゃろる',
      gender: 'FEMALE',
      prefecture: '大阪府',
      birthDate: '1980-04-04',
    })

    expect(
      app.matching.discover({ memberId: alice.id, filters: { prefecture: '大阪府' } }).map((c) => c.id),
    ).toEqual([carol.id])
    expect(
      app.matching.discover({ memberId: alice.id, filters: { gender: 'MALE' } }).map((c) => c.id),
    ).toEqual([bob.id])
    expect(
      app.matching.discover({ memberId: alice.id, filters: { maxAge: 40 } }).map((c) => c.id),
    ).toEqual([bob.id])
  })

  test('30歳未満での絞り込みは受け付けない', () => {
    expect(() => app.matching.discover({ memberId: alice.id, filters: { minAge: 25 } })).toThrow(
      'minAge',
    )
  })

  test('独身証明済みの会員が候補の上位に来る', () => {
    const certified = seedActiveMember(app, {
      email: 'certified@example.com',
      displayName: 'しょうめい',
      gender: 'MALE',
      singleCertified: true,
    })
    const candidates = app.matching.discover({ memberId: alice.id })
    expect(candidates[0].id).toBe(certified.id)
    expect(candidates[0].badges.singleCertified).toBe(true)
  })
})

describe('メッセージ', () => {
  let app
  let alice
  let bob
  let matchId

  beforeEach(() => {
    ;({ app } = createTestApp())
    alice = seedActiveMember(app, { email: 'alice2@example.com', displayName: 'あきこ' })
    bob = seedActiveMember(app, { email: 'bob2@example.com', displayName: 'ぼぶ', gender: 'MALE' })
    app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    matchId = app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.LIKE }).match.id
  })

  test('マッチした相手とはメッセージをやり取りできる', () => {
    app.messages.send({ matchId, senderId: alice.id, body: 'はじめまして' })
    app.messages.send({ matchId, senderId: bob.id, body: 'こちらこそ' })

    const thread = app.messages.list({ matchId, memberId: alice.id })
    expect(thread.map((m) => m.body)).toEqual(['はじめまして', 'こちらこそ'])
  })

  test('マッチしていない第三者はスレッドを読めない', () => {
    const carol = seedActiveMember(app, { email: 'carol2@example.com' })
    expect(() => app.messages.list({ matchId, memberId: carol.id })).toThrow(
      'マッチが見つかりません',
    )
  })

  test('マッチしていない相手には送れない', () => {
    const carol = seedActiveMember(app, { email: 'carol3@example.com' })
    expect(() =>
      app.messages.send({ matchId: 'mtc_unknown', senderId: carol.id, body: 'こんにちは' }),
    ).toThrow('マッチが見つかりません')
  })

  test('マッチ解消後はメッセージを送れない', () => {
    app.matching.unmatch({ matchId, memberId: alice.id })
    expect(() => app.messages.send({ matchId, senderId: bob.id, body: 'まだ話したい' })).toThrow(
      '終了しています',
    )
  })

  test('既読をつけられる', () => {
    app.messages.send({ matchId, senderId: bob.id, body: 'おはようございます' })
    const read = app.messages.markRead({ matchId, memberId: alice.id })
    expect(read).toHaveLength(1)
    expect(read[0].readAt).not.toBeNull()
  })
})

describe('ブロックと通報', () => {
  let app
  let alice
  let bob

  beforeEach(() => {
    ;({ app } = createTestApp())
    alice = seedActiveMember(app, { email: 'alice3@example.com' })
    bob = seedActiveMember(app, { email: 'bob3@example.com', gender: 'MALE' })
  })

  test('ブロックするとマッチが終了し、相手は候補から消える', () => {
    app.matching.react({ fromId: alice.id, toId: bob.id, type: REACTION.LIKE })
    const { match } = app.matching.react({ fromId: bob.id, toId: alice.id, type: REACTION.LIKE })

    app.safety.block({ blockerId: alice.id, blockedId: bob.id })

    expect(app.store.matches.find(match.id).status).toBe('CLOSED')
    expect(app.matching.listMatches(alice.id)).toHaveLength(0)
    expect(app.matching.discover({ memberId: bob.id }).map((c) => c.id)).not.toContain(alice.id)
    expect(() => app.messages.send({ matchId: match.id, senderId: bob.id, body: 'やあ' })).toThrow()
  })

  test('通報には紹介者が記録される', () => {
    const referred = seedActiveMember(app, {
      email: 'referred@example.com',
      referrerId: alice.id,
      gender: 'MALE',
    })
    const report = app.safety.report({
      reporterId: bob.id,
      targetId: referred.id,
      reason: 'BUSINESS_SOLICITATION',
      detail: '投資の勧誘を受けました',
    })

    expect(report.targetReferrerId).toBe(alice.id)
    expect(app.safety.listReports({ status: 'OPEN' })).toHaveLength(1)

    app.safety.resolveReport({
      reportId: report.id,
      reviewerId: OPERATOR_ID,
      resolution: '対象会員を利用停止',
    })
    expect(app.safety.listReports({ status: 'OPEN' })).toHaveLength(0)
  })

  test('推薦文はアクティブ会員だけが書け、重複投稿できない', () => {
    app.members.addEndorsement({ memberId: bob.id, authorId: alice.id, text: longText('推薦') })
    expect(app.members.get(bob.id).endorsements).toHaveLength(1)

    expect(() =>
      app.members.addEndorsement({ memberId: bob.id, authorId: alice.id, text: longText('再推薦') }),
    ).toThrow('既にこの会員へ推薦文')

    expect(() =>
      app.members.addEndorsement({ memberId: bob.id, authorId: bob.id, text: longText('自薦') }),
    ).toThrow('自分自身')
  })
})
