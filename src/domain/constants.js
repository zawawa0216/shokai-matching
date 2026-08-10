/** 入会可能な最低年齢。プロダクト要件として30歳以上限定。 */
const MIN_AGE = 30

/** 紹介文の必須文字数。形式的な一文で済ませられないよう下限を設ける。 */
const INTRODUCTION_MIN_LENGTH = 100
const INTRODUCTION_MAX_LENGTH = 2000

/** 招待コードの有効期間（日）。 */
const INVITATION_TTL_DAYS = 14

/** 1会員が同時に保持できる未使用招待の上限。 */
const MAX_OPEN_INVITATIONS = 3

/** 独身証明書は発行から3ヶ月以内のもののみ有効とする。 */
const SINGLE_CERTIFICATE_VALID_DAYS = 90

const MEMBER_STATUS = {
  /** 招待コードは使ったが、プロフィール・書類が揃っていない */
  PENDING_PROFILE: 'PENDING_PROFILE',
  /** 提出物が揃い、運営審査待ち */
  PENDING_SCREENING: 'PENDING_SCREENING',
  /** 審査通過。検索・いいね・メッセージが可能 */
  ACTIVE: 'ACTIVE',
  /** 審査却下 */
  REJECTED: 'REJECTED',
  /** 運営による利用停止 */
  SUSPENDED: 'SUSPENDED',
  /** 退会 */
  WITHDRAWN: 'WITHDRAWN',
}

const INVITATION_STATUS = {
  ISSUED: 'ISSUED',
  USED: 'USED',
  REVOKED: 'REVOKED',
}

const DOCUMENT_KIND = {
  /** 本人確認書類（必須） */
  IDENTITY: 'IDENTITY',
  /** 独身証明書（任意） */
  SINGLE_STATUS: 'SINGLE_STATUS',
}

const DOCUMENT_STATUS = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
}

const IDENTITY_DOC_TYPES = ['DRIVERS_LICENSE', 'PASSPORT', 'MY_NUMBER_CARD', 'RESIDENCE_CARD']

const REACTION = {
  LIKE: 'LIKE',
  PASS: 'PASS',
}

module.exports = {
  MIN_AGE,
  INTRODUCTION_MIN_LENGTH,
  INTRODUCTION_MAX_LENGTH,
  INVITATION_TTL_DAYS,
  MAX_OPEN_INVITATIONS,
  SINGLE_CERTIFICATE_VALID_DAYS,
  MEMBER_STATUS,
  INVITATION_STATUS,
  DOCUMENT_KIND,
  DOCUMENT_STATUS,
  IDENTITY_DOC_TYPES,
  REACTION,
}
