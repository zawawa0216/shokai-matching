const {
  MEMBER_STATUS,
  MIN_AGE,
  INTRODUCTION_MIN_LENGTH,
  INTRODUCTION_MAX_LENGTH,
} = require('../domain/constants')
const { calculateAge, parseDateOnly } = require('../domain/dates')
const { requireString, requireEmail, requireEnum, optionalString } = require('../domain/validators')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../errors')

const GENDERS = ['MALE', 'FEMALE', 'OTHER']
const INTENTS = ['MARRIAGE', 'SERIOUS_RELATIONSHIP']
const PROFILE_BIO_MIN_LENGTH = 100

/**
 * 会員の登録とプロフィール管理。
 * 登録は必ず有効な招待コードを伴い、年齢は自己申告時点で 30 歳以上を要求する
 * （最終的には本人確認書類の生年月日と突き合わせて確定させる）。
 */
function createMemberService({ store, clock, newId, invitationService, auth }) {
  function assertAdult(birthDate, now) {
    const age = calculateAge(birthDate, now)
    if (age < MIN_AGE) {
      throw new ForbiddenError(
        'AGE_REQUIREMENT_NOT_MET',
        `ご利用は${MIN_AGE}歳以上の方に限らせていただいています`,
      )
    }
    return age
  }

  function get(memberId) {
    const member = store.members.find(memberId)
    if (!member) throw new NotFoundError('会員が見つかりません')
    return member
  }

  function missingProfileFields(member) {
    const missing = []
    if (!member.profile.occupation) missing.push('occupation')
    if (!member.profile.bio || member.profile.bio.length < PROFILE_BIO_MIN_LENGTH) {
      missing.push('bio')
    }
    if (!member.profile.intent) missing.push('intent')
    if (!member.profile.photos || member.profile.photos.length === 0) missing.push('photos')
    return missing
  }

  return {
    GENDERS,
    INTENTS,
    PROFILE_BIO_MIN_LENGTH,

    /** 招待コードを消費して会員を作る。ここが唯一の会員生成経路。 */
    register({ invitationCode, email, password, displayName, birthDate, gender, prefecture }) {
      const now = clock()
      const invitation = invitationService.lookup(invitationCode)

      const normalizedEmail = requireEmail(email)
      if (normalizedEmail !== invitation.inviteeEmail) {
        throw new ForbiddenError(
          'EMAIL_MISMATCH',
          '招待されたメールアドレスと一致しません',
        )
      }
      if (store.members.findByEmail(normalizedEmail)) {
        throw new ConflictError('MEMBER_ALREADY_EXISTS', 'このメールアドレスは既に登録されています')
      }

      const name = requireString(displayName, 'displayName', { max: 40 })
      parseDateOnly(birthDate, 'birthDate')
      const age = assertAdult(birthDate, now)

      const member = store.members.save({
        id: newId.member(),
        email: normalizedEmail,
        credentials: auth.createCredentials(password),
        displayName: name,
        birthDate,
        age,
        gender: requireEnum(gender, GENDERS, 'gender'),
        prefecture: requireString(prefecture, 'prefecture', { max: 20 }),
        status: MEMBER_STATUS.PENDING_PROFILE,
        referrerId: invitation.referrer.id,
        invitationId: invitation.id,
        /** 紹介者が書いた紹介文。会員登録後も本人は編集できない。 */
        introduction: invitation.introduction,
        endorsements: [],
        profile: {
          occupation: null,
          bio: null,
          intent: null,
          photos: [],
          hobbies: [],
        },
        badges: {
          identityVerified: false,
          singleCertified: false,
        },
        verifiedBirthDate: null,
        createdAt: new Date(now).toISOString(),
        activatedAt: null,
        screening: { submittedAt: null, reviewedAt: null, reviewerId: null, reason: null },
      })

      invitationService.consume({ code: invitationCode, memberId: member.id })
      return member
    },

    updateProfile(memberId, patch) {
      const member = get(memberId)
      if ([MEMBER_STATUS.WITHDRAWN, MEMBER_STATUS.SUSPENDED].includes(member.status)) {
        throw new ForbiddenError('MEMBER_NOT_EDITABLE', 'この会員のプロフィールは編集できません')
      }

      const profile = member.profile
      if (patch.occupation !== undefined) {
        profile.occupation = optionalString(patch.occupation, 'occupation', { max: 60 }) ?? null
      }
      if (patch.bio !== undefined) {
        profile.bio = requireString(patch.bio, 'bio', { min: PROFILE_BIO_MIN_LENGTH, max: 3000 })
      }
      if (patch.intent !== undefined) {
        profile.intent = requireEnum(patch.intent, INTENTS, 'intent')
      }
      if (patch.photos !== undefined) {
        if (!Array.isArray(patch.photos) || patch.photos.length === 0) {
          throw new ValidationError('photos は1枚以上指定してください', { field: 'photos' })
        }
        profile.photos = patch.photos.slice(0, 6).map((p, i) => requireString(p, `photos[${i}]`))
      }
      if (patch.hobbies !== undefined) {
        if (!Array.isArray(patch.hobbies)) {
          throw new ValidationError('hobbies は配列で指定してください', { field: 'hobbies' })
        }
        profile.hobbies = patch.hobbies.slice(0, 10).map((h, i) => requireString(h, `hobbies[${i}]`))
      }
      if (patch.displayName !== undefined) {
        member.displayName = requireString(patch.displayName, 'displayName', { max: 40 })
      }
      if (patch.prefecture !== undefined) {
        member.prefecture = requireString(patch.prefecture, 'prefecture', { max: 20 })
      }

      return store.members.save(member)
    },

    /** 他の会員が後から追記する推薦文。任意だが信頼の裏付けになる。 */
    addEndorsement({ memberId, authorId, text }) {
      const member = get(memberId)
      const author = get(authorId)
      if (author.status !== MEMBER_STATUS.ACTIVE) {
        throw new ForbiddenError('ENDORSER_NOT_ACTIVE', '推薦文はアクティブ会員のみ投稿できます')
      }
      if (authorId === memberId) {
        throw new ForbiddenError('SELF_ENDORSEMENT', '自分自身に推薦文は書けません')
      }
      if (member.endorsements.some((e) => e.authorId === authorId)) {
        throw new ConflictError('ENDORSEMENT_EXISTS', '既にこの会員へ推薦文を書いています')
      }
      member.endorsements.push({
        id: newId.endorsement(),
        authorId,
        authorName: author.displayName,
        text: requireString(text, 'text', {
          min: INTRODUCTION_MIN_LENGTH,
          max: INTRODUCTION_MAX_LENGTH,
        }),
        writtenAt: new Date(clock()).toISOString(),
      })
      return store.members.save(member)
    },

    withdraw(memberId) {
      const member = get(memberId)
      member.status = MEMBER_STATUS.WITHDRAWN
      member.withdrawnAt = new Date(clock()).toISOString()
      return store.members.save(member)
    },

    get,
    missingProfileFields,
    isProfileComplete: (member) => missingProfileFields(member).length === 0,
    assertAdult,
  }
}

module.exports = { createMemberService, GENDERS, INTENTS, PROFILE_BIO_MIN_LENGTH }
