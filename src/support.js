const crypto = require('node:crypto')

/** 実時間に依存しないよう、時刻取得は必ずこの clock 経由で行う。 */
function systemClock() {
  return new Date()
}

/** テストで決定的な ID を得るため、生成器は差し替え可能にしておく。 */
function createIdGenerator(prefix) {
  return () => `${prefix}_${crypto.randomBytes(9).toString('hex')}`
}

/**
 * 招待コード。人が口頭・メッセージで受け渡すため、
 * 紛らわしい文字（0/O, 1/I）を除いた大文字英数字を使う。
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateInvitationCode(length = 10) {
  const bytes = crypto.randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

function normalizeInvitationCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

module.exports = {
  systemClock,
  createIdGenerator,
  generateInvitationCode,
  normalizeInvitationCode,
  CODE_ALPHABET,
}
