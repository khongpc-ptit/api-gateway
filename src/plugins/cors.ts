import cors, { FastifyCorsOptions } from '@fastify/cors';
import { FastifyInstance } from 'fastify';
import { EnvConfig } from '../config/env.js';

/**
 * Returns Fastify CORS options according to BA - SOA.md §17:
 * - Allowlist origin: PUBLIC_APP_ORIGIN (e.g. http://localhost:5173 in dev)
 * - credentials: false (tokens stored in browser memory, no cookies)
 * - No wildcard '*'
 * - Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
 * - Allowed Headers: Authorization, Content-Type, Idempotency-Key, X-Request-Id
 * - Preflight OPTIONS handled cleanly
 */
export function getCorsOptions(env: EnvConfig): FastifyCorsOptions {
  return {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or same-origin server-to-server)
      if (!origin) {
        return cb(null, true);
      }
      // Allow strictly the configured application origin
      if (origin === env.PUBLIC_APP_ORIGIN) {
        return cb(null, true);
      }
      // Reject any other origin (browser will block the request)
      return cb(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  };
}

export async function registerCors(app: FastifyInstance, env: EnvConfig): Promise<void> {
  await app.register(cors, getCorsOptions(env));
}
