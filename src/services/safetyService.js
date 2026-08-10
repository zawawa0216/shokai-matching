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
  async function getMember(memberId) {
    const member = await store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    return member
  }

  return {
    REPORT_REASONS,

    async block({ blockerId, blockedId }) {
      const blocker = await getMember(blockerId)
      const blocked = await getMember(blockedId)
      if (blocker.id === blocked.id) {
        throw new ForbiddenError('SELF_BLOCK', '自分自身はブロックできません')
      }
      await store.blocks.add(blocker.id, blocked.id)

      const match = await store.matches.findByMembers(blocker.id, blocked.id)
      if (match && match.status === 'ACTIVE') {
        match.status = 'CLOSED'
        match.closedAt = new Date(clock()).toISOString()
        match.closedBy = blocker.id
        await store.matches.save(match)
      }
      return { blockerId: blocker.id, blockedId: blocked.id }
    },

    async unblock({ blockerId, blockedId }) {
      await store.blocks.remove(blockerId, blockedId)
      return { blockerId, blockedId }
    },

    async listBlocks(memberId) {
      return store.blocks.listBy(memberId)
    },

    async report({ reporterId, targetId, reason, detail }) {
      const reporter = await getMember(reporterId)
      const target = await getMember(targetId)
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
        reviewerId: null,
        resolution: null,
        resolvedAt: null,
      })
    },

    async listReports({ status } = {}) {
      return store.reports.list(status)
    },

    async resolveReport({ reportId, reviewerId, resolution }) {
      const report = await store.reports.find(reportId)
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
