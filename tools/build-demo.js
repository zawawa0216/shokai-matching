#!/usr/bin/env node
/**
 * src/ のサービス実装をそのままブラウザで動かすための最小バンドラ。
 *
 * デモ用の UI にロジックを書き写すと本体と乖離するため、
 * CommonJS モジュールを小さなローダで包んで単一ファイルにまとめる。
 * api/ 層（node:http 依存）は含めない。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src')

const ENTRIES = [
  'app.js',
  'store.js',
  'support.js',
  'errors.js',
  'domain/constants.js',
  'domain/dates.js',
  'domain/validators.js',
  'services/authService.js',
  'services/invitationService.js',
  'services/memberService.js',
  'services/verificationService.js',
  'services/screeningService.js',
  'services/matchingService.js',
  'services/messageService.js',
  'services/safetyService.js',
]

/**
 * node:crypto と Buffer のブラウザ用スタブ。
 * ここでのハッシュはデモを動かすためだけのもので、暗号学的な強度はない。
 * 実運用は Node 側の scrypt 実装（src/services/authService.js）を使う。
 */
const PRELUDE = `
class Bytes extends Uint8Array {
  toString(encoding) {
    if (encoding === 'hex') {
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('')
    }
    return Array.from(this, (b) => String.fromCharCode(b)).join('')
  }
}

function fromHex(text) {
  const out = new Bytes(Math.floor(text.length / 2))
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.substr(i * 2, 2), 16)
  return out
}

function fromUtf8(text) {
  return new Bytes(new TextEncoder().encode(text))
}

const Buffer = {
  from(value, encoding) {
    if (value instanceof Uint8Array) return new Bytes(value)
    return encoding === 'hex' ? fromHex(String(value)) : fromUtf8(String(value))
  },
}

const nodeCrypto = {
  randomBytes(size) {
    const bytes = new Bytes(size)
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  },
  /** デモ専用の同期ハッシュ。scrypt の代用であって同等品ではない。 */
  scryptSync(password, salt, keylen) {
    const input = fromUtf8(String(salt) + '|' + String(password))
    const out = new Bytes(keylen)
    let h = 0x811c9dc5
    for (let i = 0; i < keylen; i += 1) {
      for (let j = 0; j < input.length; j += 1) {
        h ^= input[j] + i
        h = Math.imul(h, 0x01000193) >>> 0
      }
      out[i] = h & 0xff
    }
    return out
  },
  timingSafeEqual(a, b) {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
    return diff === 0
  },
}
`

function moduleId(relativePath) {
  return relativePath.replace(/\.js$/, '')
}

function build() {
  const modules = ENTRIES.map((entry) => {
    const source = fs.readFileSync(path.join(SRC, entry), 'utf8')
    return `  ${JSON.stringify(moduleId(entry))}: function (module, exports, require) {\n${source}\n  },`
  }).join('\n')

  return `/* 自動生成: tools/build-demo.js。直接編集しない。 */
window.MatchingApp = (function () {
${PRELUDE}

const modules = {
${modules}
}

const cache = {}

function normalize(dir, request) {
  if (request === 'node:crypto') return 'node:crypto'
  const segments = (dir ? dir.split('/') : []).concat(request.split('/'))
  const out = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

function load(id) {
  if (id === 'node:crypto') return nodeCrypto
  if (cache[id]) return cache[id].exports
  const factory = modules[id]
  if (!factory) throw new Error('module not found: ' + id)
  const module = { exports: {} }
  cache[id] = module
  const dir = id.split('/').slice(0, -1).join('/')
  factory(module, module.exports, (request) => load(normalize(dir, request)))
  return module.exports
}

return {
  createApp: load('app').createApp,
  constants: load('domain/constants'),
}
})()
`
}

if (require.main === module) {
  const output = process.argv[2] || path.join(__dirname, '..', 'demo', 'bundle.js')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, build())
  console.log(`wrote ${output}`)
}

module.exports = { build, ENTRIES }
