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

  /** 本人と運営に返す会員表現。認証情報は絶対に含めない。 */
  const selfView = (member) => ({
    id: member.id,
    email: member.email,
    displayName: member.displayName,
    status: member.status,
    age: member.age,
    birthDate: member.birthDate,
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
  router.get('/api/health', () => ({ ok: true }))

  router.post('/api/auth/login', ({ body }) => app.auth.login(body))

  router.get('/api/invitations/:code', ({ params }) => app.invitations.lookup(params.code))

  router.post('/api/members/register', async ({ body }) =>
    respond(201, selfView(await app.members.register(body))),
  )

  // ---- 会員本人 ------------------------------------------------------------
  router.post(
    '/api/auth/logout',
    async ({ token }) => {
      await app.auth.logout(token)
      return respond(204)
    },
    { auth: 'member' },
  )

  router.get('/api/me', ({ member }) => selfView(member), { auth: 'member' })

  router.patch(
    '/api/me',
    async ({ member, body }) => selfView(await app.members.updateProfile(member.id, body)),
    { auth: 'member' },
  )

  router.get('/api/me/screening', ({ member }) => app.screening.requirements(member.id), {
    auth: 'member',
  })

  router.post('/api/me/screening', async ({ member }) => selfView(await app.screening.submit(member.id)), {
    auth: 'member',
  })

  router.get('/api/me/documents', ({ member }) => app.verification.listByMember(member.id), {
    auth: 'member',
  })

  router.post(
    '/api/me/documents/identity',
    async ({ member, body }) =>
      respond(201, await app.verification.submitIdentityDocument({ ...body, memberId: member.id })),
    { auth: 'member' },
  )

  router.post(
    '/api/me/documents/single-status',
    async ({ member, body }) =>
      respond(
        201,
        await app.verification.submitSingleStatusCertificate({ ...body, memberId: member.id }),
      ),
    { auth: 'member' },
  )

  // ---- 紹介 ----------------------------------------------------------------
  router.get('/api/me/invitations', ({ member }) => app.invitations.listByReferrer(member.id), {
    auth: 'member',
  })

  router.post(
    '/api/me/invitations',
    async ({ member, body }) =>
      respond(201, await app.invitations.issue({ ...body, referrerId: member.id })),
    { auth: 'member' },
  )

  router.delete(
    '/api/me/invitations/:id',
    ({ member, params }) => app.invitations.revoke({ invitationId: params.id, actorId: member.id }),
    { auth: 'member' },
  )

  // ---- 相手探し ------------------------------------------------------------
  router.get(
    '/api/discover',
    ({ member, query }) => {
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
    },
    { auth: 'member' },
  )

  router.get(
    '/api/members/:id',
    ({ member, params }) => app.matching.view({ viewerId: member.id, targetId: params.id }),
    { auth: 'member' },
  )

  router.post(
    '/api/members/:id/like',
    ({ member, params }) =>
      app.matching.react({ fromId: member.id, toId: params.id, type: REACTION.LIKE }),
    { auth: 'member' },
  )

  router.post(
    '/api/members/:id/pass',
    ({ member, params }) =>
      app.matching.react({ fromId: member.id, toId: params.id, type: REACTION.PASS }),
    { auth: 'member' },
  )

  router.post(
    '/api/members/:id/endorsements',
    async ({ member, params, body }) => {
      // 対象会員をそのまま返すとメールアドレスまで露出するため、投稿された推薦文だけを返す。
      const target = await app.members.addEndorsement({
        memberId: params.id,
        authorId: member.id,
        text: body.text,
      })
      return respond(201, target.endorsements[target.endorsements.length - 1])
    },
    { auth: 'member' },
  )

  router.get('/api/likes/incoming', ({ member }) => app.matching.listIncomingLikes(member.id), {
    auth: 'member',
  })

  // ---- マッチとメッセージ ----------------------------------------------------
  router.get('/api/matches', ({ member }) => app.matching.listMatches(member.id), { auth: 'member' })

  router.delete(
    '/api/matches/:id',
    ({ member, params }) => app.matching.unmatch({ matchId: params.id, memberId: member.id }),
    { auth: 'member' },
  )

  router.get(
    '/api/matches/:id/messages',
    async ({ member, params }) => {
      const messages = await app.messages.list({ matchId: params.id, memberId: member.id })
      await app.messages.markRead({ matchId: params.id, memberId: member.id })
      return messages
    },
    { auth: 'member' },
  )

  router.post(
    '/api/matches/:id/messages',
    async ({ member, params, body }) =>
      respond(
        201,
        await app.messages.send({ matchId: params.id, senderId: member.id, body: body.body }),
      ),
    { auth: 'member' },
  )

  // ---- 安全 ----------------------------------------------------------------
  router.post(
    '/api/blocks',
    ({ member, body }) => app.safety.block({ blockerId: member.id, blockedId: body.memberId }),
    { auth: 'member' },
  )

  router.delete(
    '/api/blocks/:id',
    ({ member, params }) => app.safety.unblock({ blockerId: member.id, blockedId: params.id }),
    { auth: 'member' },
  )

  router.post(
    '/api/reports',
    async ({ member, body }) => respond(201, await app.safety.report({ ...body, reporterId: member.id })),
    { auth: 'member' },
  )

  // ---- 運営 ----------------------------------------------------------------
  router.post(
    '/api/admin/invitations',
    async ({ body, operatorId }) =>
      respond(201, await app.invitations.issueByOperator({ ...body, operatorId })),
    { auth: 'operator' },
  )

  router.get('/api/admin/documents', () => app.verification.listPending(), { auth: 'operator' })

  router.post(
    '/api/admin/documents/:id/approve',
    ({ params, operatorId }) =>
      app.verification.approve({ documentId: params.id, reviewerId: operatorId }),
    { auth: 'operator' },
  )

  router.post(
    '/api/admin/documents/:id/reject',
    ({ params, body, operatorId }) =>
      app.verification.reject({
        documentId: params.id,
        reviewerId: operatorId,
        reason: body.reason,
      }),
    { auth: 'operator' },
  )

  router.get(
    '/api/admin/screenings',
    async () => (await app.screening.listPending()).map(selfView),
    { auth: 'operator' },
  )

  router.get(
    '/api/admin/members/:id/screening',
    ({ params }) => app.screening.requirements(params.id),
    { auth: 'operator' },
  )

  router.post(
    '/api/admin/members/:id/approve',
    async ({ params, operatorId }) =>
      selfView(await app.screening.approve({ memberId: params.id, reviewerId: operatorId })),
    { auth: 'operator' },
  )

  router.post(
    '/api/admin/members/:id/reject',
    async ({ params, body, operatorId }) =>
      selfView(
        await app.screening.reject({
          memberId: params.id,
          reviewerId: operatorId,
          reason: body.reason,
        }),
      ),
    { auth: 'operator' },
  )

  router.post(
    '/api/admin/members/:id/suspend',
    async ({ params, body, operatorId }) =>
      selfView(
        await app.screening.suspend({
          memberId: params.id,
          reviewerId: operatorId,
          reason: body.reason,
        }),
      ),
    { auth: 'operator' },
  )

  router.get('/api/admin/reports', ({ query }) => app.safety.listReports({ status: query.status }), {
    auth: 'operator',
  })

  return { router, selfView }
}

module.exports = { buildRoutes }
