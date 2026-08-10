const { ValidationError } = require('../errors')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function requireString(value, field, { min = 1, max = Infinity } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} は文字列で指定してください`, { field })
  }
  const trimmed = value.trim()
  if (trimmed.length < min) {
    throw new ValidationError(`${field} は${min}文字以上で入力してください`, {
      field,
      length: trimmed.length,
      min,
    })
  }
  if (trimmed.length > max) {
    throw new ValidationError(`${field} は${max}文字以内で入力してください`, {
      field,
      length: trimmed.length,
      max,
    })
  }
  return trimmed
}

function requireEmail(value, field = 'email') {
  const email = requireString(value, field).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`${field} の形式が正しくありません`, { field })
  }
  return email
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} は ${allowed.join(' / ')} のいずれかを指定してください`, {
      field,
      allowed,
    })
  }
  return value
}

function optionalString(value, field, options) {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, field, options)
}

module.exports = {
  requireString,
  requireEmail,
  requireEnum,
  optionalString,
}
