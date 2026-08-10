const { createTestApp, seedActiveMember, longText, OPERATOR_ID } = require('./helpers')
const { INVITATION_STATUS, MAX_OPEN_INVITATIONS } = require('../src/domain/constants')

describe('紹介（招待）', () => {
  let app
  let clock
  let referrer

  beforeEach(async () => {
    ;({ app, clock } = createTestApp())
    referrer = await seedActiveMember(app, {
      email: 'referrer@example.com',
      displayName: '紹介者',
    })
  })

  test('紹介文なしでは招待を発行できない', async () => {
    await expect(
      app.invitations.issue({
        referrerId: referrer.id,
        inviteeName: '田中',
        inviteeEmail: 'tanaka@example.com',
        introduction: '',
      }),
    ).rejects.toThrow('introduction')
  })

  test.each([
    ['短すぎる紹介文', 'いい人です。'],
    ['空白のみ', '   '],
  ])('%s は拒否される', async (_label, introduction) => {
    await expect(
      app.invitations.issue({
        referrerId: referrer.id,
        inviteeName: '田中',
        inviteeEmail: 'tanaka@example.com',
        introduction,
      }),
    ).rejects.toThrow(/introduction/)
  })

  test('紹介文つきなら発行でき、紹介者と関係性が記録される', async () => {
    const invitation = await app.invitations.issue({
      referrerId: referrer.id,
      inviteeName: '田中',
      inviteeEmail: 'Tanaka@Example.com',
      introduction: longText('田中さんの紹介'),
      relationship: 'COLLEAGUE',
      knownSince: '2018年',
    })

    expect(invitation.status).toBe(INVITATION_STATUS.ISSUED)
    expect(invitation.inviteeEmail).toBe('tanaka@example.com')
    expect(invitation.introduction.authorId).toBe(referrer.id)
    expect(invitation.introduction.authorRole).toBe('MEMBER')
    expect(invitation.introduction.relationship).toBe('COLLEAGUE')
    expect(invitation.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  })

  test('審査を通過していない会員は紹介できない', async () => {
    const invitation = await app.invitations.issueByOperator({
      operatorId: OPERATOR_ID,
      inviteeName: '審査中',
      inviteeEmail: 'pending@example.com',
      introduction: longText('審査中の人の紹介'),
    })
    const pending = await app.members.register({
      invitationCode: invitation.code,
      email: 'pending@example.com',
      password: 'password-1234',
      displayName: '審査中',
      birthDate: '1985-01-01',
      gender: 'MALE',
      prefecture: '大阪府',
    })

    await expect(
      app.invitations.issue({
        referrerId: pending.id,
        inviteeName: '友人',
        inviteeEmail: 'friend@example.com',
        introduction: longText('友人の紹介'),
      }),
    ).rejects.toThrow('審査を通過した会員のみ')
  })

  test(`未使用の招待は同時に${MAX_OPEN_INVITATIONS}件まで`, async () => {
    for (let i = 0; i < MAX_OPEN_INVITATIONS; i += 1) {
      await app.invitations.issue({
        referrerId: referrer.id,
        inviteeName: `候補${i}`,
        inviteeEmail: `candidate${i}@example.com`,
        introduction: longText(`候補${i}の紹介`),
      })
    }

    await expect(
      app.invitations.issue({
        referrerId: referrer.id,
        inviteeName: '超過',
        inviteeEmail: 'over@example.com',
        introduction: longText('超過分の紹介'),
      }),
    ).rejects.toThrow(/同時に/)
  })

  test('期限が切れた招待は使えず、枠も解放される', async () => {
    const invitation = await app.invitations.issue({
      referrerId: referrer.id,
      inviteeName: '期限切れ',
      inviteeEmail: 'expired@example.com',
      introduction: longText('期限切れの紹介'),
    })

    clock.advanceDays(15)
    await expect(app.invitations.lookup(invitation.code)).rejects.toThrow('有効期限')

    await expect(
      app.invitations.issue({
        referrerId: referrer.id,
        inviteeName: '次の人',
        inviteeEmail: 'next@example.com',
        introduction: longText('次の人の紹介'),
      }),
    ).resolves.toBeDefined()
  })

  test('取り消した招待は使えない', async () => {
    const invitation = await app.invitations.issue({
      referrerId: referrer.id,
      inviteeName: '取消',
      inviteeEmail: 'revoked@example.com',
      introduction: longText('取り消す紹介'),
    })
    await app.invitations.revoke({ invitationId: invitation.id, actorId: referrer.id })
    await expect(app.invitations.lookup(invitation.code)).rejects.toThrow('取り消され')
  })

  test('他人の招待は取り消せない', async () => {
    const other = await seedActiveMember(app, { email: 'other@example.com' })
    const invitation = await app.invitations.issue({
      referrerId: referrer.id,
      inviteeName: '対象',
      inviteeEmail: 'target@example.com',
      introduction: longText('対象の紹介'),
    })
    await expect(
      app.invitations.revoke({ invitationId: invitation.id, actorId: other.id }),
    ).rejects.toThrow('権限がありません')
  })

  test('コードは大文字小文字とハイフンを無視して照合する', async () => {
    const invitation = await app.invitations.issue({
      referrerId: referrer.id,
      inviteeName: '照合',
      inviteeEmail: 'lookup@example.com',
      introduction: longText('照合テストの紹介'),
    })
    const messy = invitation.code.toLowerCase().replace('-', ' ')
    expect((await app.invitations.lookup(messy)).id).toBe(invitation.id)
  })

  test('同じ相手への有効な招待は重複発行できない', async () => {
    await app.invitations.issue({
      referrerId: referrer.id,
      inviteeName: '重複',
      inviteeEmail: 'dup@example.com',
      introduction: longText('重複の紹介'),
    })
    const another = await seedActiveMember(app, { email: 'another@example.com' })
    await expect(
      app.invitations.issue({
        referrerId: another.id,
        inviteeName: '重複',
        inviteeEmail: 'dup@example.com',
        introduction: longText('重複の紹介2'),
      }),
    ).rejects.toThrow('有効な招待が既に存在します')
  })
})
