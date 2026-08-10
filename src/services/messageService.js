const { requireString } = require('../domain/validators')
const { ConflictError } = require('../errors')

const MESSAGE_MAX_LENGTH = 2000

/**
 * マッチ成立後のメッセージ。マッチしていない相手には一切送れない。
 */
function createMessageService({ store, clock, newId, matchingService }) {
  return {
    MESSAGE_MAX_LENGTH,

    send({ matchId, senderId, body }) {
      const match = matchingService.getMatchFor(matchId, senderId)
      if (match.status !== 'ACTIVE') {
        throw new ConflictError('MATCH_CLOSED', 'このマッチは終了しています')
      }
      if (store.blocks.exists(...match.memberIds)) {
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

    list({ matchId, memberId }) {
      matchingService.getMatchFor(matchId, memberId)
      return store.messages.listByMatch(matchId)
    },

    markRead({ matchId, memberId }) {
      matchingService.getMatchFor(matchId, memberId)
      const now = new Date(clock()).toISOString()
      return store.messages
        .listByMatch(matchId)
        .filter((m) => m.senderId !== memberId && !m.readAt)
        .map((m) => {
          m.readAt = now
          return store.messages.save(m)
        })
    },
  }
}

module.exports = { createMessageService, MESSAGE_MAX_LENGTH }
