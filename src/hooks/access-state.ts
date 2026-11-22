import { FastifyRequest } from 'fastify';
import { isPublicRoute } from '../constants/routes.js';
import { AccessStateClient } from '../services/access-state.client.js';

/**
 * Hook to enforce real-time account status checking against User Service
 * according to BA - SOA.md §4:
 * - Runs in preHandler after JWT verification
 * - Calls User Service GET /internal/v1/accounts/{accountId}/access-state
 * - Skips public routes
 * - Ensures fail-closed enforcement (403 for non-active, 503 for unavailable)
 */
export function createAccessStateHook(accessStateClient: AccessStateClient) {
  return async function accessStateHook(request: FastifyRequest): Promise<void> {
    const url = request.raw.url || request.url;
    const method = request.method;

    // 1. Skip unmatched routes
    if (!request.routeOptions?.url) {
      return;
    }

    // 2. Skip public allowlist routes
    if (isPublicRoute(method, url)) {
      return;
    }

    // 3. If no user context exists, skip (jwtVerifyHook handles missing authentication)
    if (!request.user || !request.user.accountId) {
      return;
    }

    // 4. Perform synchronous, real-time edge check
    await accessStateClient.checkAccessState(request.user.accountId, request.traceId);
  };
}
