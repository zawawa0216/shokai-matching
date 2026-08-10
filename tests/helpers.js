const { createApp } = require('../src/app')

const OPERATOR_ID = 'op_test'

/** 100文字以上という下限を満たすダミー本文。 */
function longText(label) {
  return (
    `${label}。学生時代からの付き合いで、仕事にも人にも誠実に向き合う人柄をよく知っています。` +
    '約束を守り、周囲への気遣いを欠かさない人で、安心してご紹介できます。' +
    '本人の希望もあり、真剣なお付き合いを前提に登録してもらいました。'
  )
}

/** 時刻を任意に進められる clock。期限・年齢の検証で使う。 */
function createTestClock(initial = '2026-01-15T09:00:00.000Z') {
  let current = new Date(initial)
  const clock = () => new Date(current)
  clock.set = (value) => {
    current = new Date(value)
  }
  clock.advanceDays = (days) => {
    current = new Date(current.getTime() + days * 24 * 60 * 60 * 1000)
  }
  return clock
}

function createTestApp(initialTime) {
  const clock = createTestClock(initialTime)
  const app = createApp({ clock })
  return { app, clock }
}

let sequence = 0

/**
 * 招待発行から入会審査通過までを一気に進め、ACTIVE な会員を作る。
 * referrerId を渡すとその会員からの紹介、省略すると運営発行の招待になる。
 */
function seedActiveMember(app, overrides = {}) {
  sequence += 1
  const {
    referrerId = null,
    email = `member${sequence}@example.com`,
    displayName = `テスト会員${sequence}`,
    birthDate = '1988-05-20',
    gender = 'FEMALE',
    prefecture = '東京都',
    intent = 'MARRIAGE',
    password = 'password-1234',
    singleCertified = false,
  } = overrides

  const invitationPayload = {
    inviteeName: displayName,
    inviteeEmail: email,
    introduction: longText(`${displayName}さんの紹介文`),
    relationship: 'FRIEND',
    knownSince: '2015年',
  }

  const invitation = referrerId
    ? app.invitations.issue({ referrerId, ...invitationPayload })
    : app.invitations.issueByOperator({ operatorId: OPERATOR_ID, ...invitationPayload })

  const member = app.members.register({
    invitationCode: invitation.code,
    email,
    password,
    displayName,
    birthDate,
    gender,
    prefecture,
  })

  app.members.updateProfile(member.id, {
    occupation: 'デザイナー',
    bio: longText(`${displayName}の自己紹介`),
    intent,
    photos: ['photo-1.jpg'],
    hobbies: ['登山', '料理'],
  })

  const identity = app.verification.submitIdentityDocument({
    memberId: member.id,
    docType: 'PASSPORT',
    imageRef: 'identity-1.jpg',
    fullName: displayName,
    birthDate,
  })
  app.verification.approve({ documentId: identity.id, reviewerId: OPERATOR_ID })

  if (singleCertified) {
    const issuedOn = new Date(app.clock()).toISOString().slice(0, 10)
    const cert = app.verification.submitSingleStatusCertificate({
      memberId: member.id,
      imageRef: 'single-cert.jpg',
      fullName: displayName,
      issuedOn,
    })
    app.verification.approve({ documentId: cert.id, reviewerId: OPERATOR_ID })
  }

  app.screening.submit(member.id)
  app.screening.approve({ memberId: member.id, reviewerId: OPERATOR_ID })

  return app.members.get(member.id)
}

/** 招待だけ発行して、登録前の状態を作る。 */
function seedInvitation(app, overrides = {}) {
  sequence += 1
  const payload = {
    inviteeName: overrides.inviteeName || `候補者${sequence}`,
    inviteeEmail: overrides.inviteeEmail || `invitee${sequence}@example.com`,
    introduction: overrides.introduction ?? longText('候補者の紹介文'),
    relationship: overrides.relationship || 'COLLEAGUE',
  }
  return overrides.referrerId
    ? app.invitations.issue({ referrerId: overrides.referrerId, ...payload })
    : app.invitations.issueByOperator({ operatorId: OPERATOR_ID, ...payload })
}

module.exports = {
  OPERATOR_ID,
  longText,
  createTestClock,
  createTestApp,
  seedActiveMember,
  seedInvitation,
}
