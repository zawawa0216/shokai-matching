const { MEMBER_STATUS, REACTION, MIN_AGE } = require('../domain/constants')
const { calculateAge } = require('../domain/dates')
const { requireEnum } = require('../domain/validators')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../errors')

/**
 * 相手探しと相互マッチ。
 * 審査を通過した ACTIVE 会員だけが対象で、閲覧される側も ACTIVE に限る。
 */
function createMatchingService({ store, clock, newId, verificationService }) {
  async function getActive(memberId) {
    const member = await store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    if (member.status !== MEMBER_STATUS.ACTIVE) {
      throw new ForbiddenError('MEMBER_NOT_ACTIVE', '審査通過後にご利用いただけます')
    }
    return member
  }

  /** 他会員に見せるプロフィール。個人情報と認証情報は落とす。 */
  function toPublicProfile(member, now = clock()) {
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

  function passesFilters(candidate, filters, now) {
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

    /**
     * スワイプ用の候補一覧。
     * 既にリアクションした相手・マッチ済みの相手・ブロック関係にある相手を除き、
     * 独身証明済みと推薦文の多い会員を上位に出す。
     */
    async discover({ memberId, filters = {}, limit = 20 }) {
      const now = clock()
      const viewer = await getActive(memberId)
      if (filters.minAge !== undefined && filters.minAge < MIN_AGE) {
        throw new ValidationError(`minAge は${MIN_AGE}以上で指定してください`, { field: 'minAge' })
      }

      const [candidates, reacted, matches, blocks] = await Promise.all([
        store.members.listByStatus(MEMBER_STATUS.ACTIVE),
        store.reactions.listSentBy(viewer.id),
        store.matches.listByMember(viewer.id),
        store.blocks.listInvolving(viewer.id),
      ])

      const excluded = new Set([viewer.id])
      reacted.forEach((r) => excluded.add(r.toId))
      matches.forEach((m) => m.memberIds.forEach((id) => excluded.add(id)))
      blocks.forEach((b) => {
        excluded.add(b.blockerId)
        excluded.add(b.blockedId)
      })

      const visible = candidates.filter(
        (c) => !excluded.has(c.id) && passesFilters(c, filters, now),
      )

      // 期限切れの独身証明バッジは表示前に落とす。
      await Promise.all(visible.map((c) => verificationService.refreshBadges(c, now)))

      return visible
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

    async view({ viewerId, targetId }) {
      const viewer = await getActive(viewerId)
      const target = await getActive(targetId)
      if (await store.blocks.exists(viewer.id, target.id)) {
        throw new NotFoundError('会員が見つかりません')
      }
      await verificationService.refreshBadges(target)
      const profile = toPublicProfile(target)
      const matched = Boolean(await store.matches.findByMembers(viewer.id, target.id))
      return {
        ...profile,
        // 推薦文の全文はマッチ後に開示する。
        endorsements: matched ? target.endorsements : undefined,
      }
    },

    /** いいね / 見送り。相手からのいいねが既にあればマッチが成立する。 */
    async react({ fromId, toId, type }) {
      const now = clock()
      const from = await getActive(fromId)
      const to = await getActive(toId)
      requireEnum(type, [REACTION.LIKE, REACTION.PASS], 'type')

      if (from.id === to.id) {
        throw new ValidationError('自分自身にはリアクションできません', { field: 'toId' })
      }
      if (await store.blocks.exists(from.id, to.id)) {
        throw new ForbiddenError('BLOCKED', 'この会員にはリアクションできません')
      }
      if (await store.reactions.findBetween(from.id, to.id)) {
        throw new ConflictError('ALREADY_REACTED', 'この会員には既にリアクション済みです')
      }

      const reaction = await store.reactions.save({
        id: newId.reaction(),
        fromId: from.id,
        toId: to.id,
        type,
        createdAt: new Date(now).toISOString(),
      })

      if (type !== REACTION.LIKE) return { reaction, match: null }

      const reciprocal = await store.reactions.findBetween(to.id, from.id)
      if (!reciprocal || reciprocal.type !== REACTION.LIKE) return { reaction, match: null }

      const match = await store.matches.save({
        id: newId.match(),
        memberIds: [from.id, to.id],
        status: 'ACTIVE',
        createdAt: new Date(now).toISOString(),
        closedAt: null,
        closedBy: null,
      })
      return { reaction, match, partner: toPublicProfile(to, now) }
    },

    /** 自分宛のいいねのうち、まだ返事をしていないもの。 */
    async listIncomingLikes(memberId) {
      const now = clock()
      const member = await getActive(memberId)
      const received = await store.reactions.listReceivedBy(member.id)
      const likes = received.filter((r) => r.type === REACTION.LIKE)

      const results = await Promise.all(
        likes.map(async (r) => {
          const [answered, blocked, sender] = await Promise.all([
            store.reactions.findBetween(member.id, r.fromId),
            store.blocks.exists(member.id, r.fromId),
            store.members.find(r.fromId),
          ])
          if (answered || blocked || !sender || sender.status !== MEMBER_STATUS.ACTIVE) return null
          return { reactionId: r.id, createdAt: r.createdAt, member: toPublicProfile(sender, now) }
        }),
      )
      return results.filter(Boolean)
    },

    async listMatches(memberId) {
      const now = clock()
      const member = await getActive(memberId)
      const matches = await store.matches.listByMember(member.id)

      return Promise.all(
        matches
          .filter((m) => m.status === 'ACTIVE')
          .map(async (m) => {
            const partnerId = m.memberIds.find((id) => id !== member.id)
            const [partner, messages] = await Promise.all([
              store.members.find(partnerId),
              store.messages.listByMatch(m.id),
            ])
            const last = messages[messages.length - 1]
            return {
              matchId: m.id,
              createdAt: m.createdAt,
              partner: toPublicProfile(partner, now),
              lastMessage: last ? { body: last.body, senderId: last.senderId, createdAt: last.createdAt } : null,
              unreadCount: messages.filter((x) => x.senderId !== member.id && !x.readAt).length,
            }
          }),
      )
    },

    async getMatchFor(matchId, memberId) {
      const match = await store.matches.find(matchId)
      if (!match || !match.memberIds.includes(memberId)) {
        throw new NotFoundError('マッチが見つかりません')
      }
      return match
    },

    async unmatch({ matchId, memberId }) {
      const match = await this.getMatchFor(matchId, memberId)
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
