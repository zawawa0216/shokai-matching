const { createTestApp, seedInvitation, seedActiveMember, longText, OPERATOR_ID } = require('./helpers')
const { MEMBER_STATUS } = require('../src/domain/constants')

describe('入会審査', () => {
  let app

  beforeEach(() => {
    ;({ app } = createTestApp())
  })

  async function registerOnly() {
    const invitation = await seedInvitation(app)
    return app.members.register({
      invitationCode: invitation.code,
      email: invitation.inviteeEmail,
      password: 'password-1234',
      displayName: '申請者',
      birthDate: '1987-03-03',
      gender: 'MALE',
      prefecture: '福岡県',
    })
  }

  test('登録直後は必須条件が未達で、不足項目が列挙される', async () => {
    const member = await registerOnly()
    const result = await app.screening.requirements(member.id)

    expect(result.eligible).toBe(false)
    expect(result.checks).toMatchObject({
      referredByMember: true,
      hasIntroduction: true,
      identityVerified: false,
      meetsMinimumAge: false,
      profileComplete: false,
    })
    expect(result.missingProfileFields).toEqual(
      expect.arrayContaining(['occupation', 'bio', 'intent', 'photos']),
    )
  })

  test('プロフィールが埋まっていないと審査に進めない', async () => {
    const member = await registerOnly()
    const doc = await app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'MY_NUMBER_CARD',
      imageRef: 'card.jpg',
      fullName: '申請者',
      birthDate: member.birthDate,
    })
    await app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })

    await expect(app.screening.submit(member.id)).rejects.toThrow('profileComplete')
  })

  test('条件が揃えば審査待ちになり、承認でアクティブになる', async () => {
    const member = await registerOnly()
    await app.members.updateProfile(member.id, {
      occupation: 'エンジニア',
      bio: longText('自己紹介'),
      intent: 'MARRIAGE',
      photos: ['a.jpg', 'b.jpg'],
    })
    const doc = await app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'MY_NUMBER_CARD',
      imageRef: 'card.jpg',
      fullName: '申請者',
      birthDate: member.birthDate,
    })
    await app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })

    expect((await app.screening.requirements(member.id)).eligible).toBe(true)
    expect((await app.screening.submit(member.id)).status).toBe(MEMBER_STATUS.PENDING_SCREENING)
    expect((await app.screening.listPending()).map((m) => m.id)).toContain(member.id)

    const approved = await app.screening.approve({ memberId: member.id, reviewerId: OPERATOR_ID })
    expect(approved.status).toBe(MEMBER_STATUS.ACTIVE)
    expect(approved.activatedAt).not.toBeNull()
  })

  test('審査待ちでない会員は承認できない', async () => {
    const member = await registerOnly()
    await expect(
      app.screening.approve({ memberId: member.id, reviewerId: OPERATOR_ID }),
    ).rejects.toThrow('審査待ちではありません')
  })

  test('入会済みの会員は審査待ちに戻せない', async () => {
    const member = await seedActiveMember(app, { email: 'reject-target@example.com' })
    await expect(app.screening.submit(member.id)).rejects.toThrow('既に入会済み')
  })

  test('利用停止と復帰ができる', async () => {
    const member = await seedActiveMember(app)
    await app.screening.suspend({
      memberId: member.id,
      reviewerId: OPERATOR_ID,
      reason: '規約違反の疑い',
    })
    expect((await app.members.get(member.id)).status).toBe(MEMBER_STATUS.SUSPENDED)

    await app.screening.reinstate({ memberId: member.id })
    expect((await app.members.get(member.id)).status).toBe(MEMBER_STATUS.ACTIVE)
  })

  test('独身証明書は審査の必須条件に含まれない', async () => {
    const member = await seedActiveMember(app)
    const { checks } = await app.screening.requirements(member.id)
    expect(Object.keys(checks)).not.toContain('singleCertified')
  })
})
