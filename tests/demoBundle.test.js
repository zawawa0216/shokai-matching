const vm = require('node:vm')
const { build } = require('../tools/build-demo')
const { longText } = require('./helpers')

/**
 * デモ用バンドルは src/ の実装をそのまま同梱する。
 * ブラウザ向けのスタブでロジックが壊れていないことをここで担保する。
 */
function loadBundle() {
  const context = vm.createContext({
    window: {},
    globalThis: { crypto: require('node:crypto').webcrypto },
    TextEncoder,
    console,
  })
  vm.runInContext(build(), context)
  return context.window.MatchingApp
}

describe('デモ用バンドル', () => {
  test('ブラウザ環境でも招待から入会・マッチまで通る', () => {
    const { createApp, constants } = loadBundle()
    expect(constants.MIN_AGE).toBe(30)

    const app = createApp()

    const activate = (email, displayName, gender, birthDate) => {
      const invitation = app.invitations.issueByOperator({
        operatorId: 'op',
        inviteeName: displayName,
        inviteeEmail: email,
        introduction: longText(`${displayName}の紹介`),
      })
      const member = app.members.register({
        invitationCode: invitation.code,
        email,
        password: 'password-1234',
        displayName,
        birthDate,
        gender,
        prefecture: '東京都',
      })
      app.members.updateProfile(member.id, {
        occupation: '会社員',
        bio: longText('自己紹介'),
        intent: 'MARRIAGE',
        photos: ['p.jpg'],
      })
      const doc = app.verification.submitIdentityDocument({
        memberId: member.id,
        docType: 'PASSPORT',
        imageRef: 'id.jpg',
        fullName: displayName,
        birthDate,
      })
      app.verification.approve({ documentId: doc.id, reviewerId: 'op' })
      app.screening.submit(member.id)
      return app.screening.approve({ memberId: member.id, reviewerId: 'op' })
    }

    const alice = activate('a@example.com', 'あきこ', 'FEMALE', '1988-05-20')
    const bob = activate('b@example.com', 'ぼぶ', 'MALE', '1985-08-08')

    expect(app.matching.discover({ memberId: alice.id }).map((c) => c.id)).toEqual([bob.id])

    app.matching.react({ fromId: alice.id, toId: bob.id, type: 'LIKE' })
    const { match } = app.matching.react({ fromId: bob.id, toId: alice.id, type: 'LIKE' })
    expect(match).not.toBeNull()

    app.messages.send({ matchId: match.id, senderId: alice.id, body: 'はじめまして' })
    expect(app.messages.list({ matchId: match.id, memberId: bob.id })).toHaveLength(1)
  })

  test('ブラウザ環境でも30歳未満は登録できない', () => {
    const { createApp } = loadBundle()
    const app = createApp()
    const invitation = app.invitations.issueByOperator({
      operatorId: 'op',
      inviteeName: '若者',
      inviteeEmail: 'young@example.com',
      introduction: longText('若者の紹介'),
    })

    expect(() =>
      app.members.register({
        invitationCode: invitation.code,
        email: 'young@example.com',
        password: 'password-1234',
        displayName: '若者',
        birthDate: '2005-01-01',
        gender: 'MALE',
        prefecture: '東京都',
      }),
    ).toThrow('30歳以上')
  })

  test('ブラウザ環境でもパスワードは平文で残らない', () => {
    const { createApp } = loadBundle()
    const app = createApp()
    const invitation = app.invitations.issueByOperator({
      operatorId: 'op',
      inviteeName: '利用者',
      inviteeEmail: 'user@example.com',
      introduction: longText('利用者の紹介'),
    })
    const member = app.members.register({
      invitationCode: invitation.code,
      email: 'user@example.com',
      password: 'demo-password-1',
      displayName: '利用者',
      birthDate: '1990-06-06',
      gender: 'OTHER',
      prefecture: '東京都',
    })

    expect(JSON.stringify(member.credentials)).not.toContain('demo-password-1')
    expect(app.auth.verifyPassword(member, 'demo-password-1')).toBe(true)
    expect(app.auth.verifyPassword(member, 'demo-password-2')).toBe(false)
  })
})
