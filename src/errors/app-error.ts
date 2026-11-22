import { ErrorCode, ERROR_CODES } from '../constants/error-codes.js';

export class AppError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message = 'Invalid request', code: ErrorCode = ERROR_CODES.VALIDATION_ERROR, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Unauthorized', code: ErrorCode = ERROR_CODES.UNAUTHORIZED): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'Forbidden', code: ErrorCode = ERROR_CODES.FORBIDDEN): AppError {
    return new AppError(403, code, message);
  }

  static accountNotActive(message = 'Account is not active'): AppError {
    return new AppError(403, ERROR_CODES.ACCOUNT_NOT_ACTIVE, message);
  }

  static notFound(message = 'Resource not found', code: ErrorCode = ERROR_CODES.NOT_FOUND): AppError {
    return new AppError(404, code, message);
  }

  static payloadTooLarge(message = 'Payload too large'): AppError {
    return new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message);
  }

  static rateLimited(message = 'Rate limit exceeded'): AppError {
    return new AppError(429, ERROR_CODES.RATE_LIMITED, message);
  }

  static accessStateUnavailable(message = 'Account access state verification service unavailable'): AppError {
    return new AppError(503, ERROR_CODES.ACCESS_STATE_UNAVAILABLE, message);
  }

  static dependencyUnavailable(message = 'Upstream dependency unavailable'): AppError {
    return new AppError(503, ERROR_CODES.DEPENDENCY_UNAVAILABLE, message);
  }

  static internalServerError(message = 'Internal server error'): AppError {
    return new AppError(500, ERROR_CODES.INTERNAL_SERVER_ERROR, message);
  }
}
