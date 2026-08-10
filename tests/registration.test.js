const { createTestApp, seedInvitation, longText } = require('./helpers')
const { MEMBER_STATUS, MIN_AGE } = require('../src/domain/constants')

const NOW = '2026-01-15T09:00:00.000Z'

function registerWith(app, invitation, overrides = {}) {
  return app.members.register({
    invitationCode: invitation.code,
    email: invitation.inviteeEmail,
    password: 'password-1234',
    displayName: '新規会員',
    birthDate: '1990-01-01',
    gender: 'MALE',
    prefecture: '神奈川県',
    ...overrides,
  })
}

describe('会員登録', () => {
  let app

  beforeEach(() => {
    ;({ app } = createTestApp(NOW))
  })

  test('招待コードがなければ登録できない', () => {
    expect(() =>
      app.members.register({
        invitationCode: 'AAAAA-BBBBB',
        email: 'nobody@example.com',
        password: 'password-1234',
        displayName: '飛び込み',
        birthDate: '1980-01-01',
        gender: 'MALE',
        prefecture: '東京都',
      }),
    ).toThrow('招待コードが見つかりません')
  })

  test('招待されたメールアドレス以外では登録できない', () => {
    const invitation = seedInvitation(app)
    expect(() => registerWith(app, invitation, { email: 'someone.else@example.com' })).toThrow(
      '招待されたメールアドレスと一致しません',
    )
  })

  test('登録すると招待は使用済みになり、二重登録できない', () => {
    const invitation = seedInvitation(app)
    const member = registerWith(app, invitation)

    expect(member.status).toBe(MEMBER_STATUS.PENDING_PROFILE)
    expect(app.store.invitations.find(invitation.id).usedByMemberId).toBe(member.id)
    expect(() => registerWith(app, invitation, { email: invitation.inviteeEmail })).toThrow(
      /既に使用されています|既に登録されています/,
    )
  })

  test(`${MIN_AGE}歳未満は登録できない`, () => {
    const invitation = seedInvitation(app)
    // 2026-01-15 時点で29歳
    expect(() => registerWith(app, invitation, { birthDate: '1996-06-01' })).toThrow(
      `${MIN_AGE}歳以上`,
    )
  })

  test('誕生日当日に30歳になる人は登録できる', () => {
    const invitation = seedInvitation(app)
    const member = registerWith(app, invitation, { birthDate: '1996-01-15' })
    expect(member.age).toBe(MIN_AGE)
  })

  test('誕生日の前日はまだ29歳として扱う', () => {
    const invitation = seedInvitation(app)
    expect(() => registerWith(app, invitation, { birthDate: '1996-01-16' })).toThrow(
      `${MIN_AGE}歳以上`,
    )
  })

  test('紹介者が書いた紹介文が会員に引き継がれる', () => {
    const invitation = seedInvitation(app, { introduction: longText('引き継ぎ確認') })
    const member = registerWith(app, invitation)
    expect(member.introduction.text).toBe(invitation.introduction.text)
    expect(member.invitationId).toBe(invitation.id)
  })

  test('紹介文は本人がプロフィール更新で書き換えられない', () => {
    const invitation = seedInvitation(app)
    const member = registerWith(app, invitation)
    const original = member.introduction.text

    app.members.updateProfile(member.id, {
      bio: longText('自己紹介'),
      introduction: { text: '自分で書いた紹介文' },
    })

    expect(app.members.get(member.id).introduction.text).toBe(original)
  })

  test('パスワードは平文で保存されない', () => {
    const invitation = seedInvitation(app)
    const member = registerWith(app, invitation, { password: 'super-secret-1234' })
    expect(JSON.stringify(member.credentials)).not.toContain('super-secret-1234')
    expect(app.auth.verifyPassword(member, 'super-secret-1234')).toBe(true)
    expect(app.auth.verifyPassword(member, 'wrong-password-1')).toBe(false)
  })

  test('短すぎるパスワードは拒否される', () => {
    const invitation = seedInvitation(app)
    expect(() => registerWith(app, invitation, { password: 'short' })).toThrow('password')
  })

  test('自己紹介文は100文字以上が必要', () => {
    const invitation = seedInvitation(app)
    const member = registerWith(app, invitation)
    expect(() => app.members.updateProfile(member.id, { bio: 'よろしくお願いします。' })).toThrow(
      'bio',
    )
  })
})
