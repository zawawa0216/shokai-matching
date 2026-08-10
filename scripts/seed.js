#!/usr/bin/env node
/**
 * 動いている API に初期会員を投入する。
 *
 *   node scripts/seed.js --base http://localhost:3000 --operator-key <KEY>
 *
 * 紹介制なので最初の会員は運営発行の招待から作る。以降は会員同士の紹介で繋ぐ。
 * 実際の入会経路（招待→登録→書類→審査）をそのまま通すので、
 * 不整合なデータが入り込む余地がない。
 */

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1]
  }
  return args
}

const args = parseArgs(process.argv)
const BASE = (args.base || process.env.SEED_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const OPERATOR_KEY = args['operator-key'] || process.env.OPERATOR_KEY
const PASSWORD = args.password || 'shokai-demo-2026'

if (!OPERATOR_KEY) {
  console.error('運営キーが必要です: --operator-key <KEY> か環境変数 OPERATOR_KEY')
  process.exit(1)
}

async function call(method, path, { body, token, operator } = {}) {
  const headers = {}
  if (body) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  if (operator) {
    headers['x-operator-key'] = OPERATOR_KEY
    headers['x-operator-id'] = 'op_seed'
  }
  const response = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = payload && payload.error ? `${payload.error.code}: ${payload.error.message}` : text
    throw new Error(`${method} ${path} -> ${response.status} ${message}`)
  }
  return payload
}

const PEOPLE = [
  {
    name: '佐藤 みなと',
    email: 'minato@example.com',
    birthDate: '1986-04-12',
    gender: 'MALE',
    prefecture: '東京都',
    occupation: '建築設計',
    intent: 'MARRIAGE',
    relationship: 'OTHER',
    introduction:
      '立ち上げ期からの会員です。設計事務所で10年働き、住宅の改修を中心に手がけてきました。仕事の話になると止まらないところはありますが、聞き上手で、相手の話を途中で遮らない人です。休日は古い建物を見に地方へ出かけています。運営が面談のうえ登録しました。',
    bio: '住宅の改修設計をしています。休みの日は古い建物を見に地方へ出かけたり、家で蕎麦を打ったりしています。派手な場所より、静かに話せる店が好きです。長く一緒にいられる人と、暮らしを組み立て直したいと思っています。',
  },
  {
    name: '高橋 あかね',
    email: 'akane@example.com',
    birthDate: '1989-09-30',
    gender: 'FEMALE',
    prefecture: '東京都',
    occupation: '書籍編集',
    intent: 'MARRIAGE',
    relationship: 'CLASSMATE',
    referredBy: 'minato@example.com',
    singleCertified: true,
    introduction:
      '大学の同級生で、卒業して15年経ちますが今も月に一度は会っています。人の話を覚えているのが得意で、こちらが忘れていた愚痴を次に会ったときに気にかけてくれるような人です。仕事では著者との信頼で成り立つ現場に長くいます。冗談が通じる相手を探していると聞いて紹介しました。',
    bio: 'ノンフィクションの本をつくる仕事をしています。締切前はいくらか荒れますが、それ以外の時期はだいたい機嫌がいいほうです。休みの日は近所の銭湯に行ってから、その辺の店で本を読んでいます。生活の時間帯が合う人だとうれしいです。',
  },
  {
    name: '森 千尋',
    email: 'chihiro@example.com',
    birthDate: '1983-02-08',
    gender: 'FEMALE',
    prefecture: '神奈川県',
    occupation: '理学療法士',
    intent: 'SERIOUS_RELATIONSHIP',
    relationship: 'COLLEAGUE',
    referredBy: 'akane@example.com',
    introduction:
      '前の職場で3年間となりの席でした。病院勤めで生活が不規則な時期も、患者さんへの言葉づかいを崩さない人です。私が体を痛めたときは、頼んでもいないのに通える整形外科を調べて渡してくれました。山の写真を撮るのが趣味で、話し出すと長いです。誠実な相手を探しています。',
    bio: '整形外科でリハビリを担当しています。人の体に触れる仕事なので、自分自身の体調管理にはひときわ気を遣うほうです。月に一度は山に登って写真を撮っています。急がずに、少しずつお互いを知っていける関係が理想です。',
  },
  {
    name: '大野 恭平',
    email: 'kyohei@example.com',
    birthDate: '1984-11-23',
    gender: 'MALE',
    prefecture: '東京都',
    occupation: '珈琲焙煎',
    intent: 'MARRIAGE',
    relationship: 'FRIEND',
    referredBy: 'minato@example.com',
    introduction:
      '十年来の友人で、自分で焙煎所をやっています。朝が早い仕事なので夜の付き合いは悪いですが、約束は必ず守る男です。うまくいかない時期に何度か相談に乗ってもらいました。人当たりは静かで、初対面では素っ気なく見えるかもしれません。慣れるとよく笑います。',
    bio: '小さな焙煎所をやっています。朝5時に火を入れて、昼過ぎには手が空く生活です。休みの日は自転車で川沿いをのんびり走っていることが多いです。同じ景色を何度も見に行くのが好きな人だと、たぶん話が合うと思います。',
  },
]

const issuedOnToday = () => new Date().toISOString().slice(0, 10)

async function createMember(person, referrerToken) {
  const invitationPayload = {
    inviteeName: person.name,
    inviteeEmail: person.email,
    introduction: person.introduction,
    relationship: person.relationship,
  }

  const invitation = referrerToken
    ? await call('POST', '/me/invitations', { token: referrerToken, body: invitationPayload })
    : await call('POST', '/admin/invitations', { operator: true, body: invitationPayload })

  const member = await call('POST', '/members/register', {
    body: {
      invitationCode: invitation.code,
      email: person.email,
      password: PASSWORD,
      displayName: person.name,
      birthDate: person.birthDate,
      gender: person.gender,
      prefecture: person.prefecture,
    },
  })

  const { token } = await call('POST', '/auth/login', {
    body: { email: person.email, password: PASSWORD },
  })

  await call('PATCH', '/me', {
    token,
    body: {
      occupation: person.occupation,
      intent: person.intent,
      bio: person.bio,
      photos: ['no-photo'],
    },
  })

  const identity = await call('POST', '/me/documents/identity', {
    token,
    body: {
      docType: 'DRIVERS_LICENSE',
      fullName: person.name,
      birthDate: person.birthDate,
      imageRef: 'seed-identity',
    },
  })
  await call('POST', `/admin/documents/${identity.id}/approve`, { operator: true })

  if (person.singleCertified) {
    const cert = await call('POST', '/me/documents/single-status', {
      token,
      body: { fullName: person.name, issuedOn: issuedOnToday(), imageRef: 'seed-cert' },
    })
    await call('POST', `/admin/documents/${cert.id}/approve`, { operator: true })
  }

  await call('POST', '/me/screening', { token })
  await call('POST', `/admin/members/${member.id}/approve`, { operator: true })

  return { ...person, id: member.id, token }
}

/** 途中まで投入してから文字数で弾かれると中途半端な状態が残るので、先に検算する。 */
function preflight() {
  const problems = []
  for (const person of PEOPLE) {
    if (person.introduction.length < 100) problems.push(`${person.name}: 紹介文が短い`)
    if (person.bio.length < 100) problems.push(`${person.name}: 自己紹介が短い`)
  }
  if (problems.length) {
    console.error(`初期データが規約を満たしていません:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
}

;(async function main() {
  preflight()
  console.log(`seeding ${BASE}`)
  const created = new Map()

  for (const person of PEOPLE) {
    const referrer = person.referredBy ? created.get(person.referredBy) : null
    const member = await createMember(person, referrer ? referrer.token : null)
    created.set(person.email, member)
    console.log(`  ${person.name} <${person.email}>`)
  }

  console.log(`\n完了。全員のパスワードは "${PASSWORD}" です。`)
})().catch((error) => {
  console.error(`\n失敗: ${error.message}`)
  process.exit(1)
})
