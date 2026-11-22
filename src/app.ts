import cors from '@fastify/cors';
import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { EnvConfig, loadEnv } from './config/env.js';
import { PublicKeyStore, getPublicKeyStore } from './config/public-keys.js';
import { errorHandler, notFoundHandler } from './errors/error-handler.js';
import { createAccessStateHook } from './hooks/access-state.js';
import { createJwtVerifyHook } from './hooks/jwt-verify.js';
import { payloadLimitHook } from './hooks/payload-limit.js';
import { requestIdHook } from './hooks/request-id.js';
import { routeGuardHook } from './hooks/route-guard.js';
import { stripSpoofedHeadersHook } from './hooks/strip-headers.js';
import { getCorsOptions } from './plugins/cors.js';
import { reverseProxyPlugin } from './plugins/reverse-proxy.js';
import { AccessStateClient } from './services/access-state.client.js';

export interface BuildAppOptions extends FastifyServerOptions {
  publicKeyStore?: PublicKeyStore;
  accessStateClient?: AccessStateClient;
  disableProxy?: boolean;
}

export function buildApp(opts?: BuildAppOptions, envOverride?: EnvConfig): FastifyInstance {
  const env = envOverride || loadEnv();
  const publicKeyStore = opts?.publicKeyStore || getPublicKeyStore(env.JWT_PUBLIC_KEYS_JSON);
  const accessStateClient = opts?.accessStateClient || new AccessStateClient(env);

  const defaultLoggerConfig = {
    level: env.LOG_LEVEL,
    redact: [
      'req.headers.authorization',
      'req.headers["x-service-key"]',
      'headers.authorization',
      'headers["x-service-key"]',
    ],
  };

  const app = fastify({
    logger: opts?.logger !== undefined ? opts.logger : defaultLoggerConfig,
    ...opts,
  });

  // 1. CORS plugin registration (BA - SOA.md §17)
  app.register(cors, getCorsOptions(env));

  // 2. Lifecycle Hooks: onRequest
  // 2.1. Request ID & Trace ID injection
  app.addHook('onRequest', requestIdHook);
  // 2.2. Early payload size check for uploads (5 MiB boundary) (BA - SOA.md §18)
  app.addHook('onRequest', payloadLimitHook);
  // 2.3. Strip spoofed client headers (BA - SOA.md §2 & §4)
  app.addHook('onRequest', stripSpoofedHeadersHook);
  // 2.4. Route Guard: Block /internal/** & GET plots/:id/summary (BA - SOA.md §4, §15)
  app.addHook('onRequest', routeGuardHook);

  // 3. Lifecycle Hooks: preHandler
  // 3.1. JWT Verification on protected routes (BA - SOA.md §4, §19)
  app.addHook('preHandler', createJwtVerifyHook(env, publicKeyStore));
  // 3.2. Real-time Access State Enforcement (BA - SOA.md §4)
  app.addHook('preHandler', createAccessStateHook(accessStateClient));

  // 4. Reverse Proxy Registration for 6 Microservices (BA - SOA.md §15)
  if (!opts?.disableProxy) {
    app.register(reverseProxyPlugin, { env });
  }

  // 5. Global Error Handlers (conforming strictly to BA - SOA.md §3 & §10)
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // 6. Health Check Endpoint
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'UP',
      timestamp: new Date().toISOString(),
      service: 'api-gateway',
    });
  });

  return app;
}
