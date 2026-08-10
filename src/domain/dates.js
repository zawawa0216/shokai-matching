const { ValidationError } = require('../errors')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * 'YYYY-MM-DD' を UTC の Date に変換する。
 * タイムゾーンによって生年月日が1日ずれると年齢判定が狂うため、必ず UTC で扱う。
 */
function parseDateOnly(value, field = 'date') {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ValidationError(`${field} は YYYY-MM-DD 形式で指定してください`, { field })
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError(`${field} が実在しない日付です`, { field, value })
  }
  return date
}

function toDateOnlyString(date) {
  return date.toISOString().slice(0, 10)
}

/** 誕生日基準の満年齢。誕生日当日に加齢する。 */
function calculateAge(birthDate, now) {
  const birth = parseDateOnly(birthDate, 'birthDate')
  const today = new Date(now)
  let age = today.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
    age -= 1
  }
  return age
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000)
}

function daysBetween(from, to) {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000))
}

module.exports = {
  parseDateOnly,
  toDateOnlyString,
  calculateAge,
  addDays,
  daysBetween,
}
