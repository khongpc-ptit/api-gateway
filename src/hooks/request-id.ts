import { FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4, validate as validateUuid } from 'uuid';

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
  }
}

/**
 * Hook to inject/validate X-Request-Id (traceId) on every incoming request.
 * Sets traceId on request object and sets the X-Request-Id response header.
 */
export async function requestIdHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const headerValue = request.headers['x-request-id'];
  let traceId: string;

  if (typeof headerValue === 'string' && validateUuid(headerValue)) {
    traceId = headerValue;
  } else {
    traceId = uuidv4();
  }

  request.traceId = traceId;
  request.headers['x-request-id'] = traceId;
  reply.header('x-request-id', traceId);
}
