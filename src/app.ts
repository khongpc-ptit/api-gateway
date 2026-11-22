import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { EnvConfig, loadEnv } from './config/env.js';
import { errorHandler, notFoundHandler } from './errors/error-handler.js';
import { requestIdHook } from './hooks/request-id.js';

export function buildApp(opts?: FastifyServerOptions, envOverride?: EnvConfig): FastifyInstance {
  const env = envOverride || loadEnv();

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

  // 1. Hook: Request ID & Trace ID injection
  app.addHook('onRequest', requestIdHook);

  // 2. Global Error Handlers (conforming strictly to BA - SOA.md §3 & §10)
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // 3. Health Check Endpoint
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'UP',
      timestamp: new Date().toISOString(),
      service: 'api-gateway',
    });
  });

  return app;
}
