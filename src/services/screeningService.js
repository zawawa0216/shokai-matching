const { MEMBER_STATUS, MIN_AGE, DOCUMENT_KIND, DOCUMENT_STATUS } = require('../domain/constants')
const { calculateAge } = require('../domain/dates')
const { requireString } = require('../domain/validators')
const { NotFoundError, ConflictError } = require('../errors')

/**
 * 入会審査。会員が ACTIVE になる唯一の経路。
 *
 * 満たすべき条件:
 *  - 紹介者による紹介文がある（登録時点で保証される）
 *  - 本人確認書類が承認済み
 *  - 確認済みの生年月日で30歳以上
 *  - プロフィールが揃っている
 * 独身証明書は任意なので、審査条件には含めない。
 */
function createScreeningService({ store, clock, memberService, verificationService }) {
  async function get(memberId) {
    const member = await store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    return member
  }

  async function requirements(memberId) {
    const member = await memberService.get(memberId)
    const missingProfile = memberService.missingProfileFields(member)
    const identityApproved = await verificationService.hasApprovedIdentity(memberId)
    const verifiedAge = member.verifiedBirthDate
      ? calculateAge(member.verifiedBirthDate, clock())
      : null
    const singleCert = await verificationService.latestOfKind(memberId, DOCUMENT_KIND.SINGLE_STATUS)

    const checks = {
      referredByMember: Boolean(member.invitationId),
      hasIntroduction: Boolean(member.introduction && member.introduction.text),
      identityVerified: identityApproved,
      meetsMinimumAge: verifiedAge !== null && verifiedAge >= MIN_AGE,
      profileComplete: missingProfile.length === 0,
    }

    return {
      memberId,
      status: member.status,
      checks,
      missingProfileFields: missingProfile,
      verifiedAge,
      /** 任意項目。満たさなくても入会できるが、プロフィール上のバッジになる。 */
      optional: {
        singleStatusCertificate: singleCert ? singleCert.status : 'NOT_SUBMITTED',
        singleCertified: member.badges.singleCertified,
      },
      eligible: Object.values(checks).every(Boolean),
    }
  }

  return {
    requirements,

    /** 必要書類とプロフィールが揃ったら審査待ちに進める。 */
    async submit(memberId) {
      const member = await get(memberId)
      if (member.status === MEMBER_STATUS.ACTIVE) {
        throw new ConflictError('ALREADY_ACTIVE', 'この会員は既に入会済みです')
      }
      if (member.status === MEMBER_STATUS.PENDING_SCREENING) {
        throw new ConflictError('ALREADY_SUBMITTED', '既に審査待ちです')
      }
      const result = await requirements(memberId)
      if (!result.eligible) {
        const unmet = Object.entries(result.checks)
          .filter(([, ok]) => !ok)
          .map(([key]) => key)
        throw new ConflictError(
          'SCREENING_REQUIREMENTS_NOT_MET',
          `審査に進むための条件が未達です: ${unmet.join(', ')}`,
        )
      }
      member.status = MEMBER_STATUS.PENDING_SCREENING
      member.screening.submittedAt = new Date(clock()).toISOString()
      return store.members.save(member)
    },

    async approve({ memberId, reviewerId }) {
      const member = await get(memberId)
      if (member.status !== MEMBER_STATUS.PENDING_SCREENING) {
        throw new ConflictError('NOT_PENDING_SCREENING', 'この会員は審査待ちではありません')
      }
      const result = await requirements(memberId)
      if (!result.eligible) {
        throw new ConflictError('SCREENING_REQUIREMENTS_NOT_MET', '入会条件を満たしていません')
      }
      const now = new Date(clock()).toISOString()
      member.status = MEMBER_STATUS.ACTIVE
      member.activatedAt = now
      member.screening.reviewedAt = now
      member.screening.reviewerId = requireString(reviewerId, 'reviewerId')
      member.screening.reason = null
      return store.members.save(member)
    },

    async reject({ memberId, reviewerId, reason }) {
      const member = await get(memberId)
      if (member.status !== MEMBER_STATUS.PENDING_SCREENING) {
        throw new ConflictError('NOT_PENDING_SCREENING', 'この会員は審査待ちではありません')
      }
      member.status = MEMBER_STATUS.REJECTED
      member.screening.reviewedAt = new Date(clock()).toISOString()
      member.screening.reviewerId = requireString(reviewerId, 'reviewerId')
      member.screening.reason = requireString(reason, 'reason', { max: 300 })
      return store.members.save(member)
    },

    async suspend({ memberId, reviewerId, reason }) {
      const member = await get(memberId)
      member.status = MEMBER_STATUS.SUSPENDED
      member.suspension = {
        reviewerId: requireString(reviewerId, 'reviewerId'),
        reason: requireString(reason, 'reason', { max: 300 }),
        at: new Date(clock()).toISOString(),
      }
      return store.members.save(member)
    },

    async reinstate({ memberId }) {
      const member = await get(memberId)
      if (member.status !== MEMBER_STATUS.SUSPENDED) {
        throw new ConflictError('NOT_SUSPENDED', 'この会員は利用停止中ではありません')
      }
      member.status = MEMBER_STATUS.ACTIVE
      member.suspension = null
      return store.members.save(member)
    },

    async listPending() {
      return store.members.listByStatus(MEMBER_STATUS.PENDING_SCREENING)
    },

    async listPendingDocuments() {
      return store.documents.listByStatus(DOCUMENT_STATUS.SUBMITTED)
    },
  }
}

module.exports = { createScreeningService }
