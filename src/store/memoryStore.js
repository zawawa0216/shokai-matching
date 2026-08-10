const { normalizeInvitationCode } = require('../support')

/**
 * インメモリのデータストア。テストとローカル実行で使う。
 *
 * インターフェースは Supabase 実装（supabaseStore.js）と揃えるため、
 * 同期で済む処理でもすべて Promise を返す。
 */
function createMemoryStore() {
  const members = new Map()
  const invitations = new Map()
  const documents = new Map()
  const reactions = new Map()
  const matches = new Map()
  const messages = new Map()
  const reports = new Map()
  const blocks = new Map()
  const sessions = new Map()

  const all = (map) => Array.from(map.values())

  return {
    async ready() {},

    members: {
      async save(member) {
        members.set(member.id, member)
        return member
      },
      async find(id) {
        return members.get(id)
      },
      async findByEmail(email) {
        return all(members).find((m) => m.email === email)
      },
      async listByStatus(status) {
        return all(members).filter((m) => m.status === status)
      },
      async list() {
        return all(members)
      },
    },

    invitations: {
      async save(invitation) {
        invitations.set(invitation.id, invitation)
        return invitation
      },
      async find(id) {
        return invitations.get(id)
      },
      async findByCode(code) {
        const normalized = normalizeInvitationCode(code)
        return all(invitations).find((i) => normalizeInvitationCode(i.code) === normalized)
      },
      async findOpenByEmail(email) {
        return all(invitations).find((i) => i.inviteeEmail === email && i.status === 'ISSUED')
      },
      async listByReferrer(referrerId) {
        return all(invitations).filter((i) => i.referrerId === referrerId)
      },
      async list() {
        return all(invitations)
      },
    },

    documents: {
      async save(document) {
        documents.set(document.id, document)
        return document
      },
      async find(id) {
        return documents.get(id)
      },
      async listByMember(memberId) {
        return all(documents).filter((d) => d.memberId === memberId)
      },
      async listByStatus(status) {
        return all(documents).filter((d) => d.status === status)
      },
    },

    reactions: {
      async save(reaction) {
        reactions.set(reaction.id, reaction)
        return reaction
      },
      async findBetween(fromId, toId) {
        return all(reactions).find((r) => r.fromId === fromId && r.toId === toId)
      },
      async listSentBy(memberId) {
        return all(reactions).filter((r) => r.fromId === memberId)
      },
      async listReceivedBy(memberId) {
        return all(reactions).filter((r) => r.toId === memberId)
      },
    },

    matches: {
      async save(match) {
        matches.set(match.id, match)
        return match
      },
      async find(id) {
        return matches.get(id)
      },
      async findByMembers(a, b) {
        return all(matches).find((m) => m.memberIds.includes(a) && m.memberIds.includes(b))
      },
      async listByMember(memberId) {
        return all(matches).filter((m) => m.memberIds.includes(memberId))
      },
    },

    messages: {
      async save(message) {
        messages.set(message.id, message)
        return message
      },
      async listByMatch(matchId) {
        return all(messages)
          .filter((m) => m.matchId === matchId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      },
    },

    reports: {
      async save(report) {
        reports.set(report.id, report)
        return report
      },
      async find(id) {
        return reports.get(id)
      },
      async list(status) {
        return all(reports).filter((r) => !status || r.status === status)
      },
    },

    blocks: {
      /** ブロックは方向を持つが、可視性の判定では双方向に効かせる。 */
      async add(blockerId, blockedId) {
        blocks.set(`${blockerId}:${blockedId}`, {
          blockerId,
          blockedId,
          createdAt: new Date().toISOString(),
        })
      },
      async remove(blockerId, blockedId) {
        blocks.delete(`${blockerId}:${blockedId}`)
      },
      async exists(a, b) {
        return blocks.has(`${a}:${b}`) || blocks.has(`${b}:${a}`)
      },
      async listBy(blockerId) {
        return all(blocks).filter((b) => b.blockerId === blockerId)
      },
      async listInvolving(memberId) {
        return all(blocks).filter((b) => b.blockerId === memberId || b.blockedId === memberId)
      },
    },

    sessions: {
      /** サーバーレスでは実行ごとにプロセスが変わるため、セッションも永続化する。 */
      async save(session) {
        sessions.set(session.token, session)
        return session
      },
      async find(token) {
        return sessions.get(token)
      },
      async remove(token) {
        sessions.delete(token)
      },
    },
  }
}

module.exports = { createMemoryStore }
