/**
 * アプリケーション共通のエラー型。
 * code は API 層でそのままレスポンスに載せるため、安定した識別子として扱う。
 */
class AppError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, 400, details)
    this.name = 'ValidationError'
  }
}

class NotFoundError extends AppError {
  constructor(message) {
    super('NOT_FOUND', message, 404)
    this.name = 'NotFoundError'
  }
}

class ConflictError extends AppError {
  constructor(code, message) {
    super(code, message, 409)
    this.name = 'ConflictError'
  }
}

class ForbiddenError extends AppError {
  constructor(code, message) {
    super(code, message, 403)
    this.name = 'ForbiddenError'
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
}
