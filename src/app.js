const { createMemoryStore } = require('./store/memoryStore')
const { systemClock, createIdGenerator, generateInvitationCode } = require('./support')
const { createAuthService } = require('./services/authService')
const { createInvitationService } = require('./services/invitationService')
const { createMemberService } = require('./services/memberService')
const { createVerificationService } = require('./services/verificationService')
const { createScreeningService } = require('./services/screeningService')
const { createMatchingService } = require('./services/matchingService')
const { createMessageService } = require('./services/messageService')
const { createSafetyService } = require('./services/safetyService')

function defaultIdFactory() {
  return {
    member: createIdGenerator('mem'),
    invitation: createIdGenerator('inv'),
    invitationCode: () => generateInvitationCode(),
    document: createIdGenerator('doc'),
    reaction: createIdGenerator('rct'),
    match: createIdGenerator('mtc'),
    message: createIdGenerator('msg'),
    report: createIdGenerator('rep'),
    endorsement: createIdGenerator('end'),
  }
}

/**
 * 合成ルート。clock と ID 生成、そして永続化の実装をここでだけ注入する。
 * store を差し替えるだけでインメモリと Supabase を切り替えられる。
 */
function createApp({
  clock = systemClock,
  newId = defaultIdFactory(),
  store = createMemoryStore(),
} = {}) {
  const auth = createAuthService({ store, clock })
  const invitations = createInvitationService({ store, clock, newId })
  const members = createMemberService({ store, clock, newId, invitationService: invitations, auth })
  const verification = createVerificationService({ store, clock, newId })
  const screening = createScreeningService({
    store,
    clock,
    memberService: members,
    verificationService: verification,
  })
  const matching = createMatchingService({ store, clock, newId, verificationService: verification })
  const messages = createMessageService({ store, clock, newId, matchingService: matching })
  const safety = createSafetyService({ store, clock, newId })

  return {
    store,
    clock,
    auth,
    invitations,
    members,
    verification,
    screening,
    matching,
    messages,
    safety,
  }
}

module.exports = { createApp, defaultIdFactory }
