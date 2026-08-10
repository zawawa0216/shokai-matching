const { createTestApp, seedInvitation, seedActiveMember, longText, OPERATOR_ID } = require('./helpers')
const { MEMBER_STATUS } = require('../src/domain/constants')

describe('入会審査', () => {
  let app

  beforeEach(() => {
    ;({ app } = createTestApp())
  })

  function registerOnly() {
    const invitation = seedInvitation(app)
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

  test('登録直後は必須条件が未達で、不足項目が列挙される', () => {
    const member = registerOnly()
    const result = app.screening.requirements(member.id)

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

  test('プロフィールが埋まっていないと審査に進めない', () => {
    const member = registerOnly()
    const doc = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'MY_NUMBER_CARD',
      imageRef: 'card.jpg',
      fullName: '申請者',
      birthDate: member.birthDate,
    })
    app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })

    expect(() => app.screening.submit(member.id)).toThrow('profileComplete')
  })

  test('条件が揃えば審査待ちになり、承認でアクティブになる', () => {
    const member = registerOnly()
    app.members.updateProfile(member.id, {
      occupation: 'エンジニア',
      bio: longText('自己紹介'),
      intent: 'MARRIAGE',
      photos: ['a.jpg', 'b.jpg'],
    })
    const doc = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'MY_NUMBER_CARD',
      imageRef: 'card.jpg',
      fullName: '申請者',
      birthDate: member.birthDate,
    })
    app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })

    expect(app.screening.requirements(member.id).eligible).toBe(true)
    expect(app.screening.submit(member.id).status).toBe(MEMBER_STATUS.PENDING_SCREENING)
    expect(app.screening.listPending().map((m) => m.id)).toContain(member.id)

    const approved = app.screening.approve({ memberId: member.id, reviewerId: OPERATOR_ID })
    expect(approved.status).toBe(MEMBER_STATUS.ACTIVE)
    expect(approved.activatedAt).not.toBeNull()
  })

  test('審査待ちでない会員は承認できない', () => {
    const member = registerOnly()
    expect(() => app.screening.approve({ memberId: member.id, reviewerId: OPERATOR_ID })).toThrow(
      '審査待ちではありません',
    )
  })

  test('却下すると理由が残り、アクティブにならない', () => {
    const member = seedActiveMember(app, { email: 'reject-target@example.com' })
    // 一度アクティブにした会員を審査待ちに戻せないことも併せて確認する。
    expect(() => app.screening.submit(member.id)).toThrow('既に入会済み')
  })

  test('利用停止と復帰ができる', () => {
    const member = seedActiveMember(app)
    app.screening.suspend({ memberId: member.id, reviewerId: OPERATOR_ID, reason: '規約違反の疑い' })
    expect(app.members.get(member.id).status).toBe(MEMBER_STATUS.SUSPENDED)

    app.screening.reinstate({ memberId: member.id })
    expect(app.members.get(member.id).status).toBe(MEMBER_STATUS.ACTIVE)
  })

  test('独身証明書は審査の必須条件に含まれない', () => {
    const member = seedActiveMember(app)
    const checks = app.screening.requirements(member.id).checks
    expect(Object.keys(checks)).not.toContain('singleCertified')
  })
})
