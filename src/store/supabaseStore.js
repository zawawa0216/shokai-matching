const { createPostgrest, eq } = require('./postgrest')
const { normalizeInvitationCode } = require('../support')

/**
 * Supabase(Postgres) を使うストア。memoryStore と同じインターフェースを実装する。
 *
 * 行とアプリのオブジェクトの対応は下の mapper に集約する。
 * サービス層は snake_case を一切知らない。
 */

const member = {
  toRow: (m) => ({
    id: m.id,
    email: m.email,
    credentials: m.credentials,
    display_name: m.displayName,
    birth_date: m.birthDate,
    age: m.age,
    gender: m.gender,
    prefecture: m.prefecture,
    status: m.status,
    referrer_id: m.referrerId,
    invitation_id: m.invitationId,
    introduction: m.introduction,
    endorsements: m.endorsements,
    profile: m.profile,
    badges: m.badges,
    verified_birth_date: m.verifiedBirthDate,
    single_certified_until: m.singleCertifiedUntil,
    created_at: m.createdAt,
    activated_at: m.activatedAt,
    withdrawn_at: m.withdrawnAt,
    suspension: m.suspension,
    screening: m.screening,
  }),
  fromRow: (r) =>
    r && {
      id: r.id,
      email: r.email,
      credentials: r.credentials,
      displayName: r.display_name,
      birthDate: r.birth_date,
      age: r.age,
      gender: r.gender,
      prefecture: r.prefecture,
      status: r.status,
      referrerId: r.referrer_id,
      invitationId: r.invitation_id,
      introduction: r.introduction,
      endorsements: r.endorsements || [],
      profile: r.profile || {},
      badges: r.badges || {},
      verifiedBirthDate: r.verified_birth_date,
      singleCertifiedUntil: r.single_certified_until,
      createdAt: r.created_at,
      activatedAt: r.activated_at,
      withdrawnAt: r.withdrawn_at,
      suspension: r.suspension,
      screening: r.screening || {},
    },
}

const invitation = {
  toRow: (i) => ({
    id: i.id,
    code: i.code,
    referrer_id: i.referrerId,
    issued_by_operator_id: i.issuedByOperatorId,
    invitee_name: i.inviteeName,
    invitee_email: i.inviteeEmail,
    relationship: i.relationship,
    known_since: i.knownSince,
    introduction: i.introduction,
    status: i.status,
    created_at: i.createdAt,
    expires_at: i.expiresAt,
    used_at: i.usedAt,
    used_by_member_id: i.usedByMemberId,
    revoked_at: i.revokedAt,
  }),
  fromRow: (r) =>
    r && {
      id: r.id,
      code: r.code,
      referrerId: r.referrer_id,
      issuedByOperatorId: r.issued_by_operator_id,
      inviteeName: r.invitee_name,
      inviteeEmail: r.invitee_email,
      relationship: r.relationship,
      knownSince: r.known_since,
      introduction: r.introduction,
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      usedByMemberId: r.used_by_member_id,
      revokedAt: r.revoked_at,
    },
}

const document = {
  toRow: (d) => ({
    id: d.id,
    member_id: d.memberId,
    kind: d.kind,
    doc_type: d.docType,
    image_ref: d.imageRef,
    full_name: d.fullName,
    birth_date: d.birthDate,
    issued_on: d.issuedOn,
    status: d.status,
    submitted_at: d.submittedAt,
    reviewed_at: d.reviewedAt,
    reviewer_id: d.reviewerId,
    rejection_reason: d.rejectionReason,
  }),
  fromRow: (r) =>
    r && {
      id: r.id,
      memberId: r.member_id,
      kind: r.kind,
      docType: r.doc_type,
      imageRef: r.image_ref,
      fullName: r.full_name,
      birthDate: r.birth_date,
      issuedOn: r.issued_on,
      status: r.status,
      submittedAt: r.submitted_at,
      reviewedAt: r.reviewed_at,
      reviewerId: r.reviewer_id,
      rejectionReason: r.rejection_reason,
    },
}

const reaction = {
  toRow: (x) => ({
    id: x.id,
    from_id: x.fromId,
    to_id: x.toId,
    type: x.type,
    created_at: x.createdAt,
  }),
  fromRow: (r) =>
    r && { id: r.id, fromId: r.from_id, toId: r.to_id, type: r.type, createdAt: r.created_at },
}

const match = {
  toRow: (m) => ({
    id: m.id,
    member_ids: m.memberIds,
    status: m.status,
    created_at: m.createdAt,
    closed_at: m.closedAt,
    closed_by: m.closedBy,
  }),
  fromRow: (r) =>
    r && {
      id: r.id,
      memberIds: r.member_ids,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      closedBy: r.closed_by,
    },
}

const message = {
  toRow: (m) => ({
    id: m.id,
    match_id: m.matchId,
    sender_id: m.senderId,
    body: m.body,
    created_at: m.createdAt,
    read_at: m.readAt,
  }),
  fromRow: (r) =>
    r && {
      id: r.id,
      matchId: r.match_id,
      senderId: r.sender_id,
      body: r.body,
      createdAt: r.created_at,
      readAt: r.read_at,
    },
}

const report = {
  toRow: (x) => ({
    id: x.id,
    reporter_id: x.reporterId,
    target_id: x.targetId,
    target_referrer_id: x.targetReferrerId,
    reason: x.reason,
    detail: x.detail,
    status: x.status,
    created_at: x.createdAt,
    reviewer_id: x.reviewerId,
    resolution: x.resolution,
    resolved_at: x.resolvedAt,
  }),
  fromRow: (r) =>
    r && {
      id: r.id,
      reporterId: r.reporter_id,
      targetId: r.target_id,
      targetReferrerId: r.target_referrer_id,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      createdAt: r.created_at,
      reviewerId: r.reviewer_id,
      resolution: r.resolution,
      resolvedAt: r.resolved_at,
    },
}

function createSupabaseStore({ url, serviceRoleKey, fetchImpl }) {
  const db = createPostgrest({ url, serviceRoleKey, fetchImpl })
  const map = (mapper) => (rows) => (rows || []).map(mapper.fromRow)

  return {
    async ready() {},

    members: {
      async save(m) {
        return member.fromRow(await db.upsert('members', member.toRow(m)))
      },
      async find(id) {
        return member.fromRow(await db.selectOne('members', `select=*&${eq('id', id)}`))
      },
      async findByEmail(email) {
        return member.fromRow(await db.selectOne('members', `select=*&${eq('email', email)}`))
      },
      async listByStatus(status) {
        return map(member)(await db.select('members', `select=*&${eq('status', status)}`))
      },
      async list() {
        return map(member)(await db.select('members', 'select=*&order=created_at.asc'))
      },
    },

    invitations: {
      async save(i) {
        return invitation.fromRow(await db.upsert('invitations', invitation.toRow(i)))
      },
      async find(id) {
        return invitation.fromRow(await db.selectOne('invitations', `select=*&${eq('id', id)}`))
      },
      async findByCode(code) {
        // 表示用のハイフンや大文字小文字を無視して照合するため、正規化した値で引く。
        const normalized = normalizeInvitationCode(code)
        if (!normalized) return undefined
        const rows = await db.select('invitations', 'select=*')
        return invitation.fromRow(
          rows.find((r) => normalizeInvitationCode(r.code) === normalized),
        )
      },
      async findOpenByEmail(email) {
        return invitation.fromRow(
          await db.selectOne(
            'invitations',
            `select=*&${eq('invitee_email', email)}&${eq('status', 'ISSUED')}`,
          ),
        )
      },
      async listByReferrer(referrerId) {
        return map(invitation)(
          await db.select('invitations', `select=*&${eq('referrer_id', referrerId)}`),
        )
      },
      async list() {
        return map(invitation)(await db.select('invitations', 'select=*'))
      },
    },

    documents: {
      async save(d) {
        return document.fromRow(await db.upsert('documents', document.toRow(d)))
      },
      async find(id) {
        return document.fromRow(await db.selectOne('documents', `select=*&${eq('id', id)}`))
      },
      async listByMember(memberId) {
        return map(document)(
          await db.select('documents', `select=*&${eq('member_id', memberId)}`),
        )
      },
      async listByStatus(status) {
        return map(document)(
          await db.select('documents', `select=*&${eq('status', status)}&order=submitted_at.asc`),
        )
      },
    },

    reactions: {
      async save(x) {
        return reaction.fromRow(await db.upsert('reactions', reaction.toRow(x)))
      },
      async findBetween(fromId, toId) {
        return reaction.fromRow(
          await db.selectOne('reactions', `select=*&${eq('from_id', fromId)}&${eq('to_id', toId)}`),
        )
      },
      async listSentBy(memberId) {
        return map(reaction)(await db.select('reactions', `select=*&${eq('from_id', memberId)}`))
      },
      async listReceivedBy(memberId) {
        return map(reaction)(await db.select('reactions', `select=*&${eq('to_id', memberId)}`))
      },
    },

    matches: {
      async save(m) {
        return match.fromRow(await db.upsert('matches', match.toRow(m)))
      },
      async find(id) {
        return match.fromRow(await db.selectOne('matches', `select=*&${eq('id', id)}`))
      },
      async findByMembers(a, b) {
        const rows = await db.select(
          'matches',
          `select=*&member_ids=cs.{${encodeURIComponent(a)},${encodeURIComponent(b)}}`,
        )
        return match.fromRow(rows[0])
      },
      async listByMember(memberId) {
        return map(match)(
          await db.select('matches', `select=*&member_ids=cs.{${encodeURIComponent(memberId)}}`),
        )
      },
    },

    messages: {
      async save(m) {
        return message.fromRow(await db.upsert('messages', message.toRow(m)))
      },
      async listByMatch(matchId) {
        return map(message)(
          await db.select(
            'messages',
            `select=*&${eq('match_id', matchId)}&order=created_at.asc`,
          ),
        )
      },
    },

    reports: {
      async save(x) {
        return report.fromRow(await db.upsert('reports', report.toRow(x)))
      },
      async find(id) {
        return report.fromRow(await db.selectOne('reports', `select=*&${eq('id', id)}`))
      },
      async list(status) {
        const filter = status ? `&${eq('status', status)}` : ''
        return map(report)(await db.select('reports', `select=*${filter}&order=created_at.desc`))
      },
    },

    blocks: {
      async add(blockerId, blockedId) {
        await db.upsert('blocks', {
          blocker_id: blockerId,
          blocked_id: blockedId,
          created_at: new Date().toISOString(),
        })
      },
      async remove(blockerId, blockedId) {
        await db.remove('blocks', `${eq('blocker_id', blockerId)}&${eq('blocked_id', blockedId)}`)
      },
      async exists(a, b) {
        const rows = await db.select(
          'blocks',
          `select=blocker_id&or=(and(blocker_id.eq.${encodeURIComponent(a)},blocked_id.eq.${encodeURIComponent(b)}),and(blocker_id.eq.${encodeURIComponent(b)},blocked_id.eq.${encodeURIComponent(a)}))`,
        )
        return rows.length > 0
      },
      async listBy(blockerId) {
        const rows = await db.select('blocks', `select=*&${eq('blocker_id', blockerId)}`)
        return rows.map((r) => ({
          blockerId: r.blocker_id,
          blockedId: r.blocked_id,
          createdAt: r.created_at,
        }))
      },
      async listInvolving(memberId) {
        const id = encodeURIComponent(memberId)
        const rows = await db.select(
          'blocks',
          `select=*&or=(blocker_id.eq.${id},blocked_id.eq.${id})`,
        )
        return rows.map((r) => ({
          blockerId: r.blocker_id,
          blockedId: r.blocked_id,
          createdAt: r.created_at,
        }))
      },
    },

    sessions: {
      async save(session) {
        await db.upsert('sessions', {
          token: session.token,
          member_id: session.memberId,
          created_at: session.createdAt,
          expires_at: session.expiresAt,
        })
        return session
      },
      async find(token) {
        const row = await db.selectOne('sessions', `select=*&${eq('token', token)}`)
        return (
          row && {
            token: row.token,
            memberId: row.member_id,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          }
        )
      },
      async remove(token) {
        await db.remove('sessions', eq('token', token))
      },
    },
  }
}

module.exports = { createSupabaseStore }
