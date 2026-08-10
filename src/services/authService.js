const crypto = require('node:crypto')
const { requireString, requireEmail } = require('../domain/validators')
const { AppError, ValidationError } = require('../errors')

const PASSWORD_MIN_LENGTH = 10
const SESSION_TTL_HOURS = 24 * 7

/**
 * 最小限の認証。パスワードは scrypt でハッシュ化し、平文は一切保持しない。
 * セッションはインメモリの不透明トークンで、ストア同様に本番実装への差し替えを前提とする。
 */
function createAuthService({ store, clock }) {
  const sessions = new Map()

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

    login({ email, password }) {
      const member = store.members.findByEmail(requireEmail(email))
      // メールアドレスの存在有無を漏らさないため、両方のケースで同じエラーを返す。
      if (!member || !this.verifyPassword(member, password)) {
        throw new AppError('INVALID_CREDENTIALS', 'メールアドレスまたはパスワードが違います', 401)
      }
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(
        new Date(clock()).getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000,
      ).toISOString()
      sessions.set(token, { memberId: member.id, expiresAt })
      return { token, expiresAt, memberId: member.id }
    },

    authenticate(token) {
      if (!token) throw new AppError('UNAUTHENTICATED', 'ログインが必要です', 401)
      const session = sessions.get(token)
      if (!session) throw new AppError('UNAUTHENTICATED', 'ログインが必要です', 401)
      if (new Date(session.expiresAt).getTime() <= new Date(clock()).getTime()) {
        sessions.delete(token)
        throw new AppError('SESSION_EXPIRED', 'セッションの有効期限が切れました', 401)
      }
      const member = store.members.find(session.memberId)
      if (!member) throw new AppError('UNAUTHENTICATED', 'ログインが必要です', 401)
      return member
    },

    logout(token) {
      sessions.delete(token)
    },

    changePassword(member, { currentPassword, newPassword }) {
      if (!this.verifyPassword(member, currentPassword)) {
        throw new ValidationError('現在のパスワードが違います', { field: 'currentPassword' })
      }
      member.credentials = this.createCredentials(newPassword)
      return store.members.save(member)
    },
  }
}

module.exports = { createAuthService, PASSWORD_MIN_LENGTH }
