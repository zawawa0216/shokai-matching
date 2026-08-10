const { MEMBER_STATUS, REACTION, MIN_AGE } = require('../domain/constants')
const { calculateAge } = require('../domain/dates')
const { requireEnum } = require('../domain/validators')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../errors')

/**
 * 相手探しと相互マッチ。
 * 審査を通過した ACTIVE 会員だけが対象で、閲覧される側も ACTIVE に限る。
 */
function createMatchingService({ store, clock, newId, verificationService }) {
  function getActive(memberId) {
    const member = store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    if (member.status !== MEMBER_STATUS.ACTIVE) {
      throw new ForbiddenError(
        'MEMBER_NOT_ACTIVE',
        '審査通過後にご利用いただけます',
      )
    }
    return member
  }

  /** 他会員に見せるプロフィール。個人情報と認証情報は落とす。 */
  function toPublicProfile(member, now = clock()) {
    verificationService.refreshBadges(member, now)
    return {
      id: member.id,
      displayName: member.displayName,
      age: calculateAge(member.verifiedBirthDate || member.birthDate, now),
      gender: member.gender,
      prefecture: member.prefecture,
      occupation: member.profile.occupation,
      bio: member.profile.bio,
      intent: member.profile.intent,
      hobbies: member.profile.hobbies,
      photos: member.profile.photos,
      badges: { ...member.badges },
      /** 紹介制の肝。誰が何と言って紹介したかを常に開示する。 */
      introduction: {
        text: member.introduction.text,
        relationship: member.introduction.relationship ?? null,
        authorRole: member.introduction.authorRole,
        writtenAt: member.introduction.writtenAt,
      },
      endorsementCount: member.endorsements.length,
      memberSince: member.activatedAt,
    }
  }

  function isVisibleTo(viewer, candidate, filters, now) {
    if (candidate.id === viewer.id) return false
    if (candidate.status !== MEMBER_STATUS.ACTIVE) return false
    if (store.blocks.exists(viewer.id, candidate.id)) return false
    if (store.reactions.findBetween(viewer.id, candidate.id)) return false
    if (store.matches.findByMembers(viewer.id, candidate.id)) return false

    const age = calculateAge(candidate.verifiedBirthDate || candidate.birthDate, now)
    if (age < MIN_AGE) return false
    if (filters.minAge !== undefined && age < filters.minAge) return false
    if (filters.maxAge !== undefined && age > filters.maxAge) return false
    if (filters.gender && candidate.gender !== filters.gender) return false
    if (filters.prefecture && candidate.prefecture !== filters.prefecture) return false
    if (filters.intent && candidate.profile.intent !== filters.intent) return false
    if (filters.singleCertifiedOnly && !candidate.badges.singleCertified) return false
    return true
  }

  return {
    toPublicProfile,

    /** 条件に合う候補一覧。独身証明済みと推薦文の多い会員を上位に出す。 */
    discover({ memberId, filters = {}, limit = 20 }) {
      const now = clock()
      const viewer = getActive(memberId)
      if (filters.minAge !== undefined && filters.minAge < MIN_AGE) {
        throw new ValidationError(`minAge は${MIN_AGE}以上で指定してください`, { field: 'minAge' })
      }

      return store.members
        .list()
        .map((candidate) => verificationService.refreshBadges(candidate, now))
        .filter((candidate) => isVisibleTo(viewer, candidate, filters, now))
        .sort((a, b) => {
          const badge = Number(b.badges.singleCertified) - Number(a.badges.singleCertified)
          if (badge !== 0) return badge
          const endorsements = b.endorsements.length - a.endorsements.length
          if (endorsements !== 0) return endorsements
          return String(b.activatedAt).localeCompare(String(a.activatedAt))
        })
        .slice(0, limit)
        .map((candidate) => toPublicProfile(candidate, now))
    },

    view({ viewerId, targetId }) {
      const viewer = getActive(viewerId)
      const target = getActive(targetId)
      if (store.blocks.exists(viewer.id, target.id)) {
        throw new NotFoundError('会員が見つかりません')
      }
      const profile = toPublicProfile(target)
      const matched = Boolean(store.matches.findByMembers(viewer.id, target.id))
      return {
        ...profile,
        // 推薦文の全文はマッチ後に開示する。
        endorsements: matched ? target.endorsements : undefined,
      }
    },

    /** いいね / 見送り。相手からのいいねが既にあればマッチが成立する。 */
    react({ fromId, toId, type }) {
      const now = clock()
      const from = getActive(fromId)
      const to = getActive(toId)
      requireEnum(type, [REACTION.LIKE, REACTION.PASS], 'type')

      if (from.id === to.id) {
        throw new ValidationError('自分自身にはリアクションできません', { field: 'toId' })
      }
      if (store.blocks.exists(from.id, to.id)) {
        throw new ForbiddenError('BLOCKED', 'この会員にはリアクションできません')
      }
      if (store.reactions.findBetween(from.id, to.id)) {
        throw new ConflictError('ALREADY_REACTED', 'この会員には既にリアクション済みです')
      }

      const reaction = store.reactions.save({
        id: newId.reaction(),
        fromId: from.id,
        toId: to.id,
        type,
        createdAt: new Date(now).toISOString(),
      })

      if (type !== REACTION.LIKE) return { reaction, match: null }

      const reciprocal = store.reactions.findBetween(to.id, from.id)
      if (!reciprocal || reciprocal.type !== REACTION.LIKE) return { reaction, match: null }

      const match = store.matches.save({
        id: newId.match(),
        memberIds: [from.id, to.id],
        status: 'ACTIVE',
        createdAt: new Date(now).toISOString(),
        closedAt: null,
        closedBy: null,
      })
      return { reaction, match }
    },

    /** 自分宛のいいねのうち、まだ返事をしていないもの。 */
    listIncomingLikes(memberId) {
      const now = clock()
      const member = getActive(memberId)
      return store.reactions
        .listReceivedBy(member.id)
        .filter((r) => r.type === REACTION.LIKE)
        .filter((r) => !store.reactions.findBetween(member.id, r.fromId))
        .filter((r) => !store.blocks.exists(member.id, r.fromId))
        .map((r) => {
          const sender = store.members.find(r.fromId)
          return sender && sender.status === MEMBER_STATUS.ACTIVE
            ? { reactionId: r.id, createdAt: r.createdAt, member: toPublicProfile(sender, now) }
            : null
        })
        .filter(Boolean)
    },

    listMatches(memberId) {
      const now = clock()
      const member = getActive(memberId)
      return store.matches
        .listByMember(member.id)
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => {
          const partnerId = m.memberIds.find((id) => id !== member.id)
          const partner = store.members.find(partnerId)
          return {
            matchId: m.id,
            createdAt: m.createdAt,
            partner: toPublicProfile(partner, now),
          }
        })
    },

    getMatchFor(matchId, memberId) {
      const match = store.matches.find(matchId)
      if (!match || !match.memberIds.includes(memberId)) {
        throw new NotFoundError('マッチが見つかりません')
      }
      return match
    },

    unmatch({ matchId, memberId }) {
      const match = this.getMatchFor(matchId, memberId)
      if (match.status !== 'ACTIVE') {
        throw new ConflictError('MATCH_ALREADY_CLOSED', 'このマッチは既に終了しています')
      }
      match.status = 'CLOSED'
      match.closedAt = new Date(clock()).toISOString()
      match.closedBy = memberId
      return store.matches.save(match)
    },
  }
}

module.exports = { createMatchingService }
