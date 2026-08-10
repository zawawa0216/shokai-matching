const crypto = require('node:crypto')
const { requireString, requireEmail } = require('../domain/validators')
const { AppError, ValidationError } = require('../errors')

const PASSWORD_MIN_LENGTH = 10
const SESSION_TTL_HOURS = 24 * 30

/**
 * 最小限の認証。パスワードは scrypt でハッシュ化し、平文は一切保持しない。
 * セッションは不透明トークンをストアに永続化する（サーバーレスでは
 * 実行ごとにプロセスが変わるため、メモリ上に持つと即座に失効してしまう）。
 */
function createAuthService({ store, clock }) {
  function hash(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex')
  }

  return {
    PASSWORD_MIN_LENGTH,

    createCredentials(password) {
      const value = requireString(password, 'password', { min: PASSWORD_MIN_LENGTH, max: 200 })
      const salt = crypto.randomBytes(16).toString('hex')
      return { salt, hash: hash(value, salt), algorithm: 'scrypt' }
    },

    verifyPassword(member, password) {
      if (typeof password !== 'string' || !member.credentials) return false
      const candidate = Buffer.from(hash(password, member.credentials.salt), 'hex')
      const stored = Buffer.from(member.credentials.hash, 'hex')
      return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
    },

    async login({ email, password }) {
      const member = await store.members.findByEmail(requireEmail(email))
      // メールアドレスの存在有無を漏らさないため、両方のケースで同じエラーを返す。
      if (!member || !this.verifyPassword(member, password)) {
        throw new AppError('INVALID_CREDENTIALS', 'メールアドレスまたはパスワードが違います', 401)
      }
      const token = crypto.randomBytes(32).toString('hex')
      const now = new Date(clock())
      const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3600000).toISOString()
      await store.sessions.save({
        token,
        memberId: member.id,
        createdAt: now.toISOString(),
        expiresAt,
      })
      return { token, expiresAt, memberId: member.id }
    },

    async authenticate(token) {
      if (!token) throw new AppError('UNAUTHENTICATED', 'ログインが必要です', 401)
      const session = await store.sessions.find(token)
      if (!session) throw new AppError('UNAUTHENTICATED', 'ログインが必要です', 401)
      if (new Date(session.expiresAt).getTime() <= new Date(clock()).getTime()) {
        await store.sessions.remove(token)
        throw new AppError('SESSION_EXPIRED', 'セッションの有効期限が切れました', 401)
      }
      const member = await store.members.find(session.memberId)
      if (!member) throw new AppError('UNAUTHENTICATED', 'ログインが必要です', 401)
      return member
    },

    async logout(token) {
      if (token) await store.sessions.remove(token)
    },

    async changePassword(member, { currentPassword, newPassword }) {
      if (!this.verifyPassword(member, currentPassword)) {
        throw new ValidationError('現在のパスワードが違います', { field: 'currentPassword' })
      }
      member.credentials = this.createCredentials(newPassword)
      return store.members.save(member)
    },
  }
}

module.exports = { createAuthService, PASSWORD_MIN_LENGTH }
