const { requireString, requireEnum } = require('../domain/validators')
const { NotFoundError, ForbiddenError } = require('../errors')

const REPORT_REASONS = [
  'INAPPROPRIATE_MESSAGE',
  'FAKE_PROFILE',
  'BUSINESS_SOLICITATION',
  'MARRIED_OR_PARTNERED',
  'HARASSMENT',
  'OTHER',
]

/**
 * ブロックと通報。紹介制でも問題は起きるので、通報には紹介者の情報も添えて
 * 運営が紹介元まで遡れるようにしておく。
 */
function createSafetyService({ store, clock, newId }) {
  function getMember(memberId) {
    const member = store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    return member
  }

  return {
    REPORT_REASONS,

    block({ blockerId, blockedId }) {
      const blocker = getMember(blockerId)
      const blocked = getMember(blockedId)
      if (blocker.id === blocked.id) {
        throw new ForbiddenError('SELF_BLOCK', '自分自身はブロックできません')
      }
      store.blocks.add(blocker.id, blocked.id)

      const match = store.matches.findByMembers(blocker.id, blocked.id)
      if (match && match.status === 'ACTIVE') {
        match.status = 'CLOSED'
        match.closedAt = new Date(clock()).toISOString()
        match.closedBy = blocker.id
        store.matches.save(match)
      }
      return { blockerId: blocker.id, blockedId: blocked.id }
    },

    unblock({ blockerId, blockedId }) {
      store.blocks.remove(blockerId, blockedId)
      return { blockerId, blockedId }
    },

    listBlocks(memberId) {
      return store.blocks.listBy(memberId)
    },

    report({ reporterId, targetId, reason, detail }) {
      const reporter = getMember(reporterId)
      const target = getMember(targetId)
      requireEnum(reason, REPORT_REASONS, 'reason')
      return store.reports.save({
        id: newId.report(),
        reporterId: reporter.id,
        targetId: target.id,
        /** 通報対象を紹介した会員。悪質な紹介の連鎖を運営が追えるようにする。 */
        targetReferrerId: target.referrerId,
        reason,
        detail: requireString(detail ?? '', 'detail', { min: 0, max: 1000 }) || null,
        status: 'OPEN',
        createdAt: new Date(clock()).toISOString(),
      })
    },

    listReports({ status } = {}) {
      return store.reports.list().filter((r) => !status || r.status === status)
    },

    resolveReport({ reportId, reviewerId, resolution }) {
      const report = store.reports.list().find((r) => r.id === reportId)
      if (!report) throw new NotFoundError('通報が見つかりません')
      report.status = 'RESOLVED'
      report.reviewerId = requireString(reviewerId, 'reviewerId')
      report.resolution = requireString(resolution, 'resolution', { max: 500 })
      report.resolvedAt = new Date(clock()).toISOString()
      return store.reports.save(report)
    },
  }
}

module.exports = { createSafetyService, REPORT_REASONS }
