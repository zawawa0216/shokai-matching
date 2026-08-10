const { createRouter } = require('./router')
const { respond } = require('./response')
const { REACTION } = require('../domain/constants')

/**
 * HTTP ルート定義。
 * options.auth: 'member'   … ログイン必須（Authorization: Bearer <token>）
 * options.auth: 'operator' … 運営キー必須（x-operator-key）
 * 省略時は公開エンドポイント。
 */
function buildRoutes(app) {
  const router = createRouter()

  const publicMember = (member) => ({
    id: member.id,
    email: member.email,
    displayName: member.displayName,
    status: member.status,
    age: member.age,
    gender: member.gender,
    prefecture: member.prefecture,
    profile: member.profile,
    badges: member.badges,
    introduction: member.introduction,
    endorsements: member.endorsements,
    referrerId: member.referrerId,
    createdAt: member.createdAt,
    activatedAt: member.activatedAt,
  })

  // ---- 公開 ----------------------------------------------------------------
  router.post('/auth/login', ({ body }) => app.auth.login(body))

  router.get('/invitations/:code', ({ params }) => app.invitations.lookup(params.code))

  router.post('/members/register', ({ body }) => respond(201, publicMember(app.members.register(body))))

  // ---- 会員本人 ------------------------------------------------------------
  router.post('/auth/logout', ({ token }) => {
    app.auth.logout(token)
    return respond(204)
  }, { auth: 'member' })

  router.get('/me', ({ member }) => publicMember(member), { auth: 'member' })

  router.patch('/me', ({ member, body }) => publicMember(app.members.updateProfile(member.id, body)), {
    auth: 'member',
  })

  router.get('/me/screening', ({ member }) => app.screening.requirements(member.id), {
    auth: 'member',
  })

  router.post('/me/screening', ({ member }) => publicMember(app.screening.submit(member.id)), {
    auth: 'member',
  })

  router.get('/me/documents', ({ member }) => app.verification.listByMember(member.id), {
    auth: 'member',
  })

  router.post(
    '/me/documents/identity',
    ({ member, body }) => respond(201, app.verification.submitIdentityDocument({ ...body, memberId: member.id })),
    { auth: 'member' },
  )

  router.post(
    '/me/documents/single-status',
    ({ member, body }) => respond(201, app.verification.submitSingleStatusCertificate({ ...body, memberId: member.id })),
    { auth: 'member' },
  )

  // ---- 紹介 ----------------------------------------------------------------
  router.get('/me/invitations', ({ member }) => app.invitations.listByReferrer(member.id), {
    auth: 'member',
  })

  router.post(
    '/me/invitations',
    ({ member, body }) => respond(201, app.invitations.issue({ ...body, referrerId: member.id })),
    { auth: 'member' },
  )

  router.delete(
    '/me/invitations/:id',
    ({ member, params }) =>
      app.invitations.revoke({ invitationId: params.id, actorId: member.id }),
    { auth: 'member' },
  )

  // ---- 相手探し ------------------------------------------------------------
  router.get('/discover', ({ member, query }) => {
    const filters = {}
    if (query.minAge) filters.minAge = Number(query.minAge)
    if (query.maxAge) filters.maxAge = Number(query.maxAge)
    if (query.gender) filters.gender = query.gender
    if (query.prefecture) filters.prefecture = query.prefecture
    if (query.intent) filters.intent = query.intent
    if (query.singleCertifiedOnly === 'true') filters.singleCertifiedOnly = true
    return app.matching.discover({
      memberId: member.id,
      filters,
      limit: query.limit ? Number(query.limit) : undefined,
    })
  }, { auth: 'member' })

  router.get(
    '/members/:id',
    ({ member, params }) => app.matching.view({ viewerId: member.id, targetId: params.id }),
    { auth: 'member' },
  )

  router.post(
    '/members/:id/like',
    ({ member, params }) =>
      app.matching.react({ fromId: member.id, toId: params.id, type: REACTION.LIKE }),
    { auth: 'member' },
  )

  router.post(
    '/members/:id/pass',
    ({ member, params }) =>
      app.matching.react({ fromId: member.id, toId: params.id, type: REACTION.PASS }),
    { auth: 'member' },
  )

  router.post(
    '/members/:id/endorsements',
    ({ member, params, body }) => {
      // 対象会員のオブジェクトをそのまま返すとメールアドレスまで露出するため、
      // 投稿された推薦文だけを返す。
      const target = app.members.addEndorsement({
        memberId: params.id,
        authorId: member.id,
        text: body.text,
      })
      return respond(201, target.endorsements[target.endorsements.length - 1])
    },
    { auth: 'member' },
  )

  router.get('/likes/incoming', ({ member }) => app.matching.listIncomingLikes(member.id), {
    auth: 'member',
  })

  // ---- マッチとメッセージ ----------------------------------------------------
  router.get('/matches', ({ member }) => app.matching.listMatches(member.id), { auth: 'member' })

  router.delete(
    '/matches/:id',
    ({ member, params }) => app.matching.unmatch({ matchId: params.id, memberId: member.id }),
    { auth: 'member' },
  )

  router.get(
    '/matches/:id/messages',
    ({ member, params }) => app.messages.list({ matchId: params.id, memberId: member.id }),
    { auth: 'member' },
  )

  router.post(
    '/matches/:id/messages',
    ({ member, params, body }) => respond(201, app.messages.send({ matchId: params.id, senderId: member.id, body: body.body })),
    { auth: 'member' },
  )

  // ---- 安全 ----------------------------------------------------------------
  router.post(
    '/blocks',
    ({ member, body }) => app.safety.block({ blockerId: member.id, blockedId: body.memberId }),
    { auth: 'member' },
  )

  router.delete(
    '/blocks/:id',
    ({ member, params }) => app.safety.unblock({ blockerId: member.id, blockedId: params.id }),
    { auth: 'member' },
  )

  router.post(
    '/reports',
    ({ member, body }) => respond(201, app.safety.report({ ...body, reporterId: member.id })),
    { auth: 'member' },
  )

  // ---- 運営 ----------------------------------------------------------------
  router.post(
    '/admin/invitations',
    ({ body, operatorId }) => respond(201, app.invitations.issueByOperator({ ...body, operatorId })),
    { auth: 'operator' },
  )

  router.get('/admin/documents', () => app.verification.listPending(), { auth: 'operator' })

  router.post(
    '/admin/documents/:id/approve',
    ({ params, operatorId }) => app.verification.approve({ documentId: params.id, reviewerId: operatorId }),
    { auth: 'operator' },
  )

  router.post(
    '/admin/documents/:id/reject',
    ({ params, body, operatorId }) =>
      app.verification.reject({ documentId: params.id, reviewerId: operatorId, reason: body.reason }),
    { auth: 'operator' },
  )

  router.get('/admin/screenings', () => app.screening.listPending().map(publicMember), {
    auth: 'operator',
  })

  router.post(
    '/admin/members/:id/approve',
    ({ params, operatorId }) =>
      publicMember(app.screening.approve({ memberId: params.id, reviewerId: operatorId })),
    { auth: 'operator' },
  )

  router.post(
    '/admin/members/:id/reject',
    ({ params, body, operatorId }) =>
      publicMember(
        app.screening.reject({ memberId: params.id, reviewerId: operatorId, reason: body.reason }),
      ),
    { auth: 'operator' },
  )

  router.post(
    '/admin/members/:id/suspend',
    ({ params, body, operatorId }) =>
      publicMember(
        app.screening.suspend({ memberId: params.id, reviewerId: operatorId, reason: body.reason }),
      ),
    { auth: 'operator' },
  )

  router.get('/admin/reports', ({ query }) => app.safety.listReports({ status: query.status }), {
    auth: 'operator',
  })

  return { router, publicMember }
}

module.exports = { buildRoutes }
