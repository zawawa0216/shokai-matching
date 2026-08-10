/**
 * ハンドラの戻り値がステータス付きレスポンスかどうかを、Symbol で明示的に判別する。
 * ドメインオブジェクトも `status` プロパティを持ちうるため、
 * プロパティの有無で判定すると会員ステータスが HTTP ステータスとして解釈されてしまう。
 */
const RESPONSE = Symbol('httpResponse')

function respond(status, body) {
  return { [RESPONSE]: true, status, body }
}

function isResponse(value) {
  return Boolean(value) && typeof value === 'object' && value[RESPONSE] === true
}

module.exports = { RESPONSE, respond, isResponse }
