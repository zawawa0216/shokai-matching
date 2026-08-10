const {
  INVITATION_STATUS,
  INTRODUCTION_MIN_LENGTH,
  INTRODUCTION_MAX_LENGTH,
  INVITATION_TTL_DAYS,
  MAX_OPEN_INVITATIONS,
  MEMBER_STATUS,
} = require('../domain/constants')
const { addDays } = require('../domain/dates')
const { requireString, requireEmail, optionalString } = require('../domain/validators')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../errors')

const RELATIONSHIPS = ['FRIEND', 'COLLEAGUE', 'CLASSMATE', 'FAMILY', 'CLIENT', 'OTHER']

/**
 * 紹介（招待）の発行と検証。
 *
 * このサービスがアプリ全体の入口であり、以下2つの不変条件を守る責務を持つ:
 *  1. 招待なしに会員は生まれない（紹介制）
 *  2. 招待には必ず紹介者が書いた紹介文が添付される
 */
function createInvitationService({ store, clock, newId }) {
  function validateIntroduction(input) {
    const text = requireString(input, 'introduction', {
      min: INTRODUCTION_MIN_LENGTH,
      max: INTRODUCTION_MAX_LENGTH,
    })
    return text
  }

  function isExpired(invitation, now = clock()) {
    return new Date(invitation.expiresAt).getTime() <= new Date(now).getTime()
  }

  function assertUsable(invitation, now = clock()) {
    if (invitation.status === INVITATION_STATUS.USED) {
      throw new ConflictError('INVITATION_ALREADY_USED', 'この招待コードは既に使用されています')
    }
    if (invitation.status === INVITATION_STATUS.REVOKED) {
      throw new ConflictError('INVITATION_REVOKED', 'この招待コードは取り消されています')
    }
    if (isExpired(invitation, now)) {
      throw new ConflictError('INVITATION_EXPIRED', 'この招待コードは有効期限が切れています')
    }
  }

  function buildInvitation({ referrerId, issuedByOperatorId, payload, now }) {
    const introduction = validateIntroduction(payload.introduction)
    const inviteeName = requireString(payload.inviteeName, 'inviteeName', { max: 60 })
    const inviteeEmail = requireEmail(payload.inviteeEmail, 'inviteeEmail')
    const relationship = payload.relationship || 'OTHER'
    if (!RELATIONSHIPS.includes(relationship)) {
      throw new ValidationError('relationship の値が不正です', {
        field: 'relationship',
        allowed: RELATIONSHIPS,
      })
    }
    const knownSince = optionalString(payload.knownSince, 'knownSince', { max: 60 })

    if (store.members.findByEmail(inviteeEmail)) {
      throw new ConflictError('MEMBER_ALREADY_EXISTS', 'このメールアドレスは既に登録されています')
    }

    const openForSameEmail = store.invitations
      .list()
      .find(
        (i) => i.inviteeEmail === inviteeEmail && i.status === INVITATION_STATUS.ISSUED && !isExpired(i, now),
      )
    if (openForSameEmail) {
      throw new ConflictError(
        'INVITATION_ALREADY_ISSUED',
        'このメールアドレス宛の有効な招待が既に存在します',
      )
    }

    const timestamp = new Date(now).toISOString()
    return store.invitations.save({
      id: newId.invitation(),
      code: newId.invitationCode(),
      referrerId: referrerId ?? null,
      issuedByOperatorId: issuedByOperatorId ?? null,
      inviteeName,
      inviteeEmail,
      relationship,
      knownSince: knownSince || null,
      introduction: {
        text: introduction,
        authorId: referrerId ?? issuedByOperatorId ?? null,
        authorRole: referrerId ? 'MEMBER' : 'OPERATOR',
        relationship,
        knownSince: knownSince || null,
        writtenAt: timestamp,
      },
      status: INVITATION_STATUS.ISSUED,
      createdAt: timestamp,
      expiresAt: addDays(now, INVITATION_TTL_DAYS).toISOString(),
      usedAt: null,
      usedByMemberId: null,
    })
  }

  return {
    RELATIONSHIPS,

    /** 既存のアクティブ会員が知人を紹介する。 */
    issue({ referrerId, ...payload }) {
      const now = clock()
      const referrer = store.members.find(referrerId)
      if (!referrer) throw new NotFoundError('紹介者が見つかりません')
      if (referrer.status !== MEMBER_STATUS.ACTIVE) {
        throw new ForbiddenError(
          'REFERRER_NOT_ACTIVE',
          '審査を通過した会員のみ紹介を発行できます',
        )
      }

      const openCount = store.invitations
        .listByReferrer(referrerId)
        .filter((i) => i.status === INVITATION_STATUS.ISSUED && !isExpired(i, now)).length
      if (openCount >= MAX_OPEN_INVITATIONS) {
        throw new ConflictError(
          'INVITATION_LIMIT_REACHED',
          `未使用の招待は同時に${MAX_OPEN_INVITATIONS}件までです`,
        )
      }

      return buildInvitation({ referrerId, payload, now })
    },

    /** 立ち上げ期の初期会員など、運営が直接発行する招待。紹介文は運営が書く。 */
    issueByOperator({ operatorId, ...payload }) {
      const now = clock()
      requireString(operatorId, 'operatorId')
      return buildInvitation({ issuedByOperatorId: operatorId, payload, now })
    },

    /** 登録画面で招待コードの有効性と紹介文を表示するための参照。 */
    lookup(code) {
      const invitation = store.invitations.findByCode(code)
      if (!invitation) throw new NotFoundError('招待コードが見つかりません')
      assertUsable(invitation)
      const referrer = invitation.referrerId ? store.members.find(invitation.referrerId) : null
      return {
        id: invitation.id,
        inviteeName: invitation.inviteeName,
        inviteeEmail: invitation.inviteeEmail,
        relationship: invitation.relationship,
        introduction: invitation.introduction,
        referrer: referrer
          ? { id: referrer.id, displayName: referrer.displayName }
          : { id: null, displayName: '運営事務局' },
        expiresAt: invitation.expiresAt,
      }
    },

    revoke({ invitationId, actorId }) {
      const invitation = store.invitations.find(invitationId)
      if (!invitation) throw new NotFoundError('招待が見つかりません')
      if (invitation.referrerId && invitation.referrerId !== actorId) {
        throw new ForbiddenError('NOT_INVITATION_OWNER', 'この招待を取り消す権限がありません')
      }
      if (invitation.status === INVITATION_STATUS.USED) {
        throw new ConflictError('INVITATION_ALREADY_USED', '使用済みの招待は取り消せません')
      }
      invitation.status = INVITATION_STATUS.REVOKED
      invitation.revokedAt = new Date(clock()).toISOString()
      return store.invitations.save(invitation)
    },

    listByReferrer(referrerId) {
      return store.invitations.listByReferrer(referrerId)
    },

    /** 会員登録時に memberService から呼ばれる内部 API。 */
    consume({ code, memberId }) {
      const now = clock()
      const invitation = store.invitations.findByCode(code)
      if (!invitation) throw new NotFoundError('招待コードが見つかりません')
      assertUsable(invitation, now)
      invitation.status = INVITATION_STATUS.USED
      invitation.usedAt = new Date(now).toISOString()
      invitation.usedByMemberId = memberId
      return store.invitations.save(invitation)
    },

    assertUsable,
    isExpired,
  }
}

module.exports = { createInvitationService, RELATIONSHIPS }
