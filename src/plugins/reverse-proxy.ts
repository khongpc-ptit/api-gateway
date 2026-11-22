import httpProxy from '@fastify/http-proxy';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { EnvConfig } from '../config/env.js';

export interface RouteProxyConfig {
  prefix: string;
  upstream: string;
  ws?: boolean;
}

/**
 * Returns the routing table mapping public API prefixes to upstream microservices
 * according to BA - SOA.md §15.
 */
export function getProxyRoutes(env: EnvConfig): RouteProxyConfig[] {
  return [
    // 1. User Service (Port 8081)
    { prefix: '/api/v1/auth', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/users', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/farmers', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/traders', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/admin/accounts', upstream: env.USER_SERVICE_URL },

    // 2. Farming Service (Port 8082)
    { prefix: '/api/v1/plots', upstream: env.FARMING_SERVICE_URL },
    { prefix: '/api/v1/crop-seasons', upstream: env.FARMING_SERVICE_URL },
    { prefix: '/api/v1/logs', upstream: env.FARMING_SERVICE_URL },
    { prefix: '/api/v1/costs', upstream: env.FARMING_SERVICE_URL },

    // 3. Trading Service (Port 8083)
    { prefix: '/api/v1/listings', upstream: env.TRADING_SERVICE_URL },
    { prefix: '/api/v1/offers', upstream: env.TRADING_SERVICE_URL },

    // 4. Chat Service (Port 8084) - REST & WebSocket
    { prefix: '/api/v1/conversations', upstream: env.CHAT_SERVICE_URL },
    { prefix: '/ws/chat', upstream: env.CHAT_SERVICE_WS_URL, ws: true },

    // 5. Payment Service (Port 8085)
    { prefix: '/api/v1/payments', upstream: env.PAYMENT_SERVICE_URL },

    // 6. Notification Service (Port 8086)
    { prefix: '/api/v1/notifications', upstream: env.NOTIFICATION_SERVICE_URL },
  ];
}

export interface ReverseProxyPluginOptions {
  env: EnvConfig;
}

/**
 * Fastify plugin to register reverse proxies for all 6 microservices with @fastify/http-proxy.
 * Preserves the /api/v1/... prefix and supports raw streaming for multipart upload.
 */
export const reverseProxyPlugin: FastifyPluginAsync<ReverseProxyPluginOptions> = async (
  app: FastifyInstance,
  opts: ReverseProxyPluginOptions
) => {
  const { env } = opts;
  const routes = getProxyRoutes(env);

  for (const route of routes) {
    if (route.ws) {
      await app.register(httpProxy, {
        upstream: route.upstream,
        prefix: route.prefix,
        websocket: true,
      });
    } else {
      await app.register(httpProxy, {
        upstream: route.upstream,
        prefix: route.prefix,
        rewritePrefix: route.prefix, // Preserves the exact /api/v1/... prefix
        http2: false,
      });
    }
  }
};
