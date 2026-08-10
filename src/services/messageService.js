const { requireString } = require('../domain/validators')
const { ConflictError } = require('../errors')

const MESSAGE_MAX_LENGTH = 2000

/**
 * マッチ成立後のメッセージ。マッチしていない相手には一切送れない。
 */
function createMessageService({ store, clock, newId, matchingService }) {
  return {
    MESSAGE_MAX_LENGTH,

    async send({ matchId, senderId, body }) {
      const match = await matchingService.getMatchFor(matchId, senderId)
      if (match.status !== 'ACTIVE') {
        throw new ConflictError('MATCH_CLOSED', 'このマッチは終了しています')
      }
      if (await store.blocks.exists(...match.memberIds)) {
        throw new ConflictError('BLOCKED', 'この相手にはメッセージを送れません')
      }
      return store.messages.save({
        id: newId.message(),
        matchId,
        senderId,
        body: requireString(body, 'body', { max: MESSAGE_MAX_LENGTH }),
        createdAt: new Date(clock()).toISOString(),
        readAt: null,
      })
    },

    async list({ matchId, memberId }) {
      await matchingService.getMatchFor(matchId, memberId)
      return store.messages.listByMatch(matchId)
    },

    async markRead({ matchId, memberId }) {
      await matchingService.getMatchFor(matchId, memberId)
      const now = new Date(clock()).toISOString()
      const messages = await store.messages.listByMatch(matchId)
      const unread = messages.filter((m) => m.senderId !== memberId && !m.readAt)
      return Promise.all(
        unread.map((m) => {
          m.readAt = now
          return store.messages.save(m)
        }),
      )
    },
  }
}

module.exports = { createMessageService, MESSAGE_MAX_LENGTH }
