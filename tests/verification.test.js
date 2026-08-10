const { createTestApp, seedInvitation, seedActiveMember, longText, OPERATOR_ID } = require('./helpers')
const {
  DOCUMENT_STATUS,
  MEMBER_STATUS,
  SINGLE_CERTIFICATE_VALID_DAYS,
} = require('../src/domain/constants')

const NOW = '2026-01-15T09:00:00.000Z'

function registerPending(app, { birthDate = '1988-05-20' } = {}) {
  const invitation = seedInvitation(app)
  const member = app.members.register({
    invitationCode: invitation.code,
    email: invitation.inviteeEmail,
    password: 'password-1234',
    displayName: '書類提出者',
    birthDate,
    gender: 'FEMALE',
    prefecture: '東京都',
  })
  app.members.updateProfile(member.id, {
    occupation: '会社員',
    bio: longText('自己紹介'),
    intent: 'MARRIAGE',
    photos: ['photo.jpg'],
  })
  return app.members.get(member.id)
}

describe('本人確認書類（必須）', () => {
  let app
  let clock

  beforeEach(() => {
    ;({ app, clock } = createTestApp(NOW))
  })

  test('本人確認が未承認のうちは審査に進めない', () => {
    const member = registerPending(app)
    expect(() => app.screening.submit(member.id)).toThrow('identityVerified')
  })

  test('承認されるとバッジが付き、審査に進める', () => {
    const member = registerPending(app)
    const doc = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'DRIVERS_LICENSE',
      imageRef: 'license.jpg',
      fullName: '書類提出者',
      birthDate: member.birthDate,
    })
    app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })

    const updated = app.members.get(member.id)
    expect(updated.badges.identityVerified).toBe(true)
    expect(updated.verifiedBirthDate).toBe(member.birthDate)
    expect(app.screening.submit(member.id).status).toBe(MEMBER_STATUS.PENDING_SCREENING)
  })

  test('書類の生年月日が申告と違えば承認できない', () => {
    const member = registerPending(app, { birthDate: '1988-05-20' })
    const doc = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'PASSPORT',
      imageRef: 'passport.jpg',
      fullName: '書類提出者',
      birthDate: '1988-05-21',
    })
    expect(() => app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })).toThrow(
      '一致しません',
    )
    expect(app.members.get(member.id).badges.identityVerified).toBe(false)
  })

  test('未対応の書類種別は受け付けない', () => {
    const member = registerPending(app)
    expect(() =>
      app.verification.submitIdentityDocument({
        memberId: member.id,
        docType: 'STUDENT_ID',
        imageRef: 'student.jpg',
        fullName: '書類提出者',
        birthDate: member.birthDate,
      }),
    ).toThrow('docType')
  })

  test('審査中に同じ種別を重ねて出せない / 却下後は再提出できる', () => {
    const member = registerPending(app)
    const first = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'PASSPORT',
      imageRef: 'blurry.jpg',
      fullName: '書類提出者',
      birthDate: member.birthDate,
    })

    expect(() =>
      app.verification.submitIdentityDocument({
        memberId: member.id,
        docType: 'PASSPORT',
        imageRef: 'again.jpg',
        fullName: '書類提出者',
        birthDate: member.birthDate,
      }),
    ).toThrow('審査中')

    app.verification.reject({
      documentId: first.id,
      reviewerId: OPERATOR_ID,
      reason: '文字が読み取れません',
    })
    expect(app.store.documents.find(first.id).status).toBe(DOCUMENT_STATUS.REJECTED)

    const second = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'PASSPORT',
      imageRef: 'clear.jpg',
      fullName: '書類提出者',
      birthDate: member.birthDate,
    })
    expect(() =>
      app.verification.approve({ documentId: second.id, reviewerId: OPERATOR_ID }),
    ).not.toThrow()
  })

  test('書類の生年月日が30歳未満なら承認されない', () => {
    const member = registerPending(app, { birthDate: '1996-01-15' })
    const doc = app.verification.submitIdentityDocument({
      memberId: member.id,
      docType: 'PASSPORT',
      imageRef: 'passport.jpg',
      fullName: '書類提出者',
      birthDate: '1996-01-15',
    })

    // 登録から時間が巻き戻ることはないが、書類審査時点での年齢を必ず再計算する。
    clock.set('2025-12-31T00:00:00.000Z')
    expect(() => app.verification.approve({ documentId: doc.id, reviewerId: OPERATOR_ID })).toThrow(
      '30歳未満',
    )
  })
})

describe('独身証明書（任意）', () => {
  let app
  let clock

  beforeEach(() => {
    ;({ app, clock } = createTestApp(NOW))
  })

  test('提出しなくても入会できる', () => {
    const member = seedActiveMember(app)
    expect(member.status).toBe(MEMBER_STATUS.ACTIVE)
    expect(member.badges.singleCertified).toBe(false)
    expect(app.screening.requirements(member.id).optional.singleStatusCertificate).toBe(
      'NOT_SUBMITTED',
    )
  })

  test('承認されるとバッジが付く', () => {
    const member = seedActiveMember(app, { singleCertified: true })
    expect(member.badges.singleCertified).toBe(true)
    expect(app.screening.requirements(member.id).optional.singleStatusCertificate).toBe('APPROVED')
  })

  test(`発行から${SINGLE_CERTIFICATE_VALID_DAYS}日を超えた証明書は提出できない`, () => {
    const member = seedActiveMember(app)
    expect(() =>
      app.verification.submitSingleStatusCertificate({
        memberId: member.id,
        imageRef: 'old-cert.jpg',
        fullName: member.displayName,
        issuedOn: '2025-09-01',
      }),
    ).toThrow(`${SINGLE_CERTIFICATE_VALID_DAYS}日以内`)
  })

  test('未来の発行日は受け付けない', () => {
    const member = seedActiveMember(app)
    expect(() =>
      app.verification.submitSingleStatusCertificate({
        memberId: member.id,
        imageRef: 'future-cert.jpg',
        fullName: member.displayName,
        issuedOn: '2026-03-01',
      }),
    ).toThrow('未来の日付')
  })

  test('有効期限を過ぎるとバッジは自動的に外れる', () => {
    const member = seedActiveMember(app, { singleCertified: true })
    expect(member.badges.singleCertified).toBe(true)

    clock.advanceDays(SINGLE_CERTIFICATE_VALID_DAYS + 1)
    app.verification.refreshBadges(app.members.get(member.id))

    expect(app.members.get(member.id).badges.singleCertified).toBe(false)
    // 入会資格そのものは失われない（あくまで任意項目）。
    expect(app.members.get(member.id).status).toBe(MEMBER_STATUS.ACTIVE)
  })
})
