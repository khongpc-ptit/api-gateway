import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, ErrorCode } from '../constants/error-codes.js';
import { AppError } from './app-error.js';

export interface ErrorContractPayload {
  timestamp: string;
  status: number;
  code: string;
  message: string;
  path: string;
  traceId: string;
}

/**
 * Global Fastify error handler conforming strictly to BA - SOA.md (§3 & §10)
 */
export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const timestamp = new Date().toISOString();
  const path = request.raw.url || request.url;
  const traceId = request.traceId || (request.id as string) || 'unknown-trace-id';

  let status = 500;
  let code: ErrorCode = ERROR_CODES.INTERNAL_SERVER_ERROR;
  let message = 'Internal server error';

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (
    ('code' in error &&
      (error.code === 'FST_REPLY_FROM_INTERNAL_SERVER_ERROR' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        error.code === 'UND_ERR_SOCKET')) ||
    error.message?.includes('ECONNREFUSED') ||
    error.message?.includes('connect ECONNREFUSED')
  ) {
    // BA - SOA.md §3: Upstream dependency down or unreachable
    status = 503;
    code = ERROR_CODES.DEPENDENCY_UNAVAILABLE;
    message = 'Upstream dependency unavailable';
  } else if ('validation' in error && error.validation) {
    status = 400;
    code = ERROR_CODES.VALIDATION_ERROR;
    message = error.message || 'Validation error';
  } else if ('statusCode' in error && typeof error.statusCode === 'number') {
    status = error.statusCode;
    if (status === 404) {
      code = ERROR_CODES.NOT_FOUND;
      message = 'Resource not found';
    } else if (status === 413) {
      code = ERROR_CODES.PAYLOAD_TOO_LARGE;
      message = 'Payload too large';
    } else if (status === 429) {
      code = ERROR_CODES.RATE_LIMITED;
      message = 'Rate limit exceeded';
    } else if (status === 400) {
      code = ERROR_CODES.VALIDATION_ERROR;
      message = error.message;
    } else {
      code = ERROR_CODES.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    }
  }

  // Log server errors (5xx) with full context and stack trace, without redacting traceId
  if (status >= 500) {
    request.log.error(
      {
        err: error,
        traceId,
        path,
        status,
        code,
      },
      `[Gateway Error] ${message}`
    );
  } else {
    request.log.warn(
      {
        traceId,
        path,
        status,
        code,
      },
      `[Gateway Client Error] ${message}`
    );
  }

  const payload: ErrorContractPayload = {
    timestamp,
    status,
    code,
    message,
    path,
    traceId,
  };

  reply.status(status).send(payload);
}

/**
 * Handler for unmatched routes (404 Not Found)
 */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  const timestamp = new Date().toISOString();
  const path = request.raw.url || request.url;
  const traceId = request.traceId || (request.id as string) || 'unknown-trace-id';

  const payload: ErrorContractPayload = {
    timestamp,
    status: 404,
    code: ERROR_CODES.NOT_FOUND,
    message: 'Route not found',
    path,
    traceId,
  };

  reply.status(404).send(payload);
}
