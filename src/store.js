const { normalizeInvitationCode } = require('./support')

/**
 * インメモリのデータストア。
 * サービス層が永続化の実装を知らずに済むよう、コレクション単位の素朴な API に絞っている。
 * 本番では同じインターフェースの RDB 実装に差し替える想定。
 */
function createStore() {
  const members = new Map()
  const invitations = new Map()
  const documents = new Map()
  const reactions = new Map()
  const matches = new Map()
  const messages = new Map()
  const reports = new Map()
  const blocks = new Map()

  function all(map) {
    return Array.from(map.values())
  }

  return {
    members: {
      save(member) {
        members.set(member.id, member)
        return member
      },
      find(id) {
        return members.get(id)
      },
      findByEmail(email) {
        return all(members).find((m) => m.email === email)
      },
      list() {
        return all(members)
      },
    },

    invitations: {
      save(invitation) {
        invitations.set(invitation.id, invitation)
        return invitation
      },
      find(id) {
        return invitations.get(id)
      },
      findByCode(code) {
        const normalized = normalizeInvitationCode(code)
        return all(invitations).find((i) => normalizeInvitationCode(i.code) === normalized)
      },
      listByReferrer(referrerId) {
        return all(invitations).filter((i) => i.referrerId === referrerId)
      },
      list() {
        return all(invitations)
      },
    },

    documents: {
      save(document) {
        documents.set(document.id, document)
        return document
      },
      find(id) {
        return documents.get(id)
      },
      listByMember(memberId) {
        return all(documents).filter((d) => d.memberId === memberId)
      },
      list() {
        return all(documents)
      },
    },

    reactions: {
      save(reaction) {
        reactions.set(reaction.id, reaction)
        return reaction
      },
      findBetween(fromId, toId) {
        return all(reactions).find((r) => r.fromId === fromId && r.toId === toId)
      },
      listSentBy(memberId) {
        return all(reactions).filter((r) => r.fromId === memberId)
      },
      listReceivedBy(memberId) {
        return all(reactions).filter((r) => r.toId === memberId)
      },
    },

    matches: {
      save(match) {
        matches.set(match.id, match)
        return match
      },
      find(id) {
        return matches.get(id)
      },
      findByMembers(a, b) {
        return all(matches).find((m) => m.memberIds.includes(a) && m.memberIds.includes(b))
      },
      listByMember(memberId) {
        return all(matches).filter((m) => m.memberIds.includes(memberId))
      },
    },

    messages: {
      save(message) {
        messages.set(message.id, message)
        return message
      },
      listByMatch(matchId) {
        return all(messages)
          .filter((m) => m.matchId === matchId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      },
    },

    reports: {
      save(report) {
        reports.set(report.id, report)
        return report
      },
      list() {
        return all(reports)
      },
    },

    blocks: {
      /** ブロックは方向を持つが、可視性の判定では双方向に効かせる。 */
      add(blockerId, blockedId) {
        blocks.set(`${blockerId}:${blockedId}`, {
          blockerId,
          blockedId,
          createdAt: new Date().toISOString(),
        })
      },
      remove(blockerId, blockedId) {
        blocks.delete(`${blockerId}:${blockedId}`)
      },
      exists(a, b) {
        return blocks.has(`${a}:${b}`) || blocks.has(`${b}:${a}`)
      },
      listBy(blockerId) {
        return all(blocks).filter((b) => b.blockerId === blockerId)
      },
    },
  }
}

module.exports = { createStore }
