const {
  DOCUMENT_KIND,
  DOCUMENT_STATUS,
  IDENTITY_DOC_TYPES,
  MEMBER_STATUS,
  MIN_AGE,
  SINGLE_CERTIFICATE_VALID_DAYS,
} = require('../domain/constants')
const { calculateAge, parseDateOnly, daysBetween, addDays } = require('../domain/dates')
const { requireString, requireEnum } = require('../domain/validators')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../errors')

/**
 * 本人確認書類（必須）と独身証明書（任意）の提出・審査。
 *
 * 年齢の最終的な根拠は自己申告ではなく本人確認書類の生年月日に置く。
 * 承認時に書類の生年月日と申告値が食い違えば承認は通さない。
 */
function createVerificationService({ store, clock, newId }) {
  async function getMember(memberId) {
    const member = await store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    return member
  }

  async function latestOfKind(memberId, kind) {
    const docs = await store.documents.listByMember(memberId)
    return docs
      .filter((d) => d.kind === kind)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]
  }

  async function submit({ memberId, kind, docType, imageRef, birthDate, fullName, issuedOn }) {
    const member = await getMember(memberId)
    if ([MEMBER_STATUS.WITHDRAWN, MEMBER_STATUS.SUSPENDED].includes(member.status)) {
      throw new ForbiddenError('MEMBER_NOT_ACTIVE', 'この会員は書類を提出できません')
    }

    const pending = await latestOfKind(memberId, kind)
    if (pending && pending.status === DOCUMENT_STATUS.SUBMITTED) {
      throw new ConflictError('DOCUMENT_UNDER_REVIEW', '同じ種類の書類が審査中です')
    }
    if (pending && pending.status === DOCUMENT_STATUS.APPROVED && kind === DOCUMENT_KIND.IDENTITY) {
      throw new ConflictError('DOCUMENT_ALREADY_APPROVED', '本人確認は既に完了しています')
    }

    return store.documents.save({
      id: newId.document(),
      memberId,
      kind,
      docType,
      imageRef: requireString(imageRef, 'imageRef'),
      fullName: requireString(fullName, 'fullName', { max: 60 }),
      birthDate: birthDate ?? null,
      issuedOn: issuedOn ?? null,
      status: DOCUMENT_STATUS.SUBMITTED,
      submittedAt: new Date(clock()).toISOString(),
      reviewedAt: null,
      reviewerId: null,
      rejectionReason: null,
    })
  }

  /** 独身証明書は発行から一定期間内のものだけを有効扱いする。 */
  function isSingleCertificateValid(document, now = clock()) {
    if (!document || document.status !== DOCUMENT_STATUS.APPROVED || !document.issuedOn) return false
    return (
      daysBetween(parseDateOnly(document.issuedOn, 'issuedOn'), now) <=
      SINGLE_CERTIFICATE_VALID_DAYS
    )
  }

  /** 期限切れの独身証明バッジを落とす。参照系から呼ばれる冪等な処理。 */
  async function refreshBadges(member, now = clock()) {
    if (!member.badges.singleCertified) return member
    const cert = await latestOfKind(member.id, DOCUMENT_KIND.SINGLE_STATUS)
    if (isSingleCertificateValid(cert, now)) return member

    member.badges.singleCertified = false
    member.singleCertifiedUntil = null
    await store.members.save(member)
    return member
  }

  return {
    /** 本人確認書類の提出。入会に必須。 */
    async submitIdentityDocument({ memberId, docType, imageRef, fullName, birthDate }) {
      requireEnum(docType, IDENTITY_DOC_TYPES, 'docType')
      parseDateOnly(birthDate, 'birthDate')
      return submit({
        memberId,
        kind: DOCUMENT_KIND.IDENTITY,
        docType,
        imageRef,
        fullName,
        birthDate,
      })
    },

    /** 独身証明書の提出。任意提出で、承認されるとバッジが付く。 */
    async submitSingleStatusCertificate({ memberId, imageRef, fullName, issuedOn }) {
      const now = clock()
      const issued = parseDateOnly(issuedOn, 'issuedOn')
      if (issued.getTime() > new Date(now).getTime()) {
        throw new ValidationError('issuedOn に未来の日付は指定できません', { field: 'issuedOn' })
      }
      if (daysBetween(issued, now) > SINGLE_CERTIFICATE_VALID_DAYS) {
        throw new ValidationError(
          `独身証明書は発行から${SINGLE_CERTIFICATE_VALID_DAYS}日以内のものを提出してください`,
          { field: 'issuedOn' },
        )
      }
      return submit({
        memberId,
        kind: DOCUMENT_KIND.SINGLE_STATUS,
        docType: 'SINGLE_STATUS_CERTIFICATE',
        imageRef,
        fullName,
        issuedOn,
      })
    },

    async approve({ documentId, reviewerId }) {
      const document = await store.documents.find(documentId)
      if (!document) throw new NotFoundError('書類が見つかりません')
      if (document.status !== DOCUMENT_STATUS.SUBMITTED) {
        throw new ConflictError('DOCUMENT_NOT_PENDING', 'この書類は審査済みです')
      }
      const member = await getMember(document.memberId)
      const now = clock()

      if (document.kind === DOCUMENT_KIND.IDENTITY) {
        if (document.birthDate !== member.birthDate) {
          throw new ConflictError(
            'BIRTHDATE_MISMATCH',
            '申告された生年月日と本人確認書類の記載が一致しません',
          )
        }
        const age = calculateAge(document.birthDate, now)
        if (age < MIN_AGE) {
          throw new ConflictError(
            'AGE_REQUIREMENT_NOT_MET',
            `本人確認書類の生年月日が${MIN_AGE}歳未満です`,
          )
        }
        member.verifiedBirthDate = document.birthDate
        member.age = age
        member.badges.identityVerified = true
      } else {
        member.badges.singleCertified = true
        member.singleCertifiedUntil = addDays(
          parseDateOnly(document.issuedOn, 'issuedOn'),
          SINGLE_CERTIFICATE_VALID_DAYS,
        ).toISOString()
      }

      document.status = DOCUMENT_STATUS.APPROVED
      document.reviewedAt = new Date(now).toISOString()
      document.reviewerId = requireString(reviewerId, 'reviewerId')
      await store.members.save(member)
      return store.documents.save(document)
    },

    async reject({ documentId, reviewerId, reason }) {
      const document = await store.documents.find(documentId)
      if (!document) throw new NotFoundError('書類が見つかりません')
      if (document.status !== DOCUMENT_STATUS.SUBMITTED) {
        throw new ConflictError('DOCUMENT_NOT_PENDING', 'この書類は審査済みです')
      }
      document.status = DOCUMENT_STATUS.REJECTED
      document.reviewedAt = new Date(clock()).toISOString()
      document.reviewerId = requireString(reviewerId, 'reviewerId')
      document.rejectionReason = requireString(reason, 'reason', { max: 300 })
      return store.documents.save(document)
    },

    async listByMember(memberId) {
      return store.documents.listByMember(memberId)
    },

    async listPending() {
      return store.documents.listByStatus(DOCUMENT_STATUS.SUBMITTED)
    },

    async hasApprovedIdentity(memberId) {
      const doc = await latestOfKind(memberId, DOCUMENT_KIND.IDENTITY)
      return Boolean(doc && doc.status === DOCUMENT_STATUS.APPROVED)
    },

    latestOfKind,
    isSingleCertificateValid,
    refreshBadges,
  }
}

module.exports = { createVerificationService }
