import { FastifyRequest } from 'fastify';
import { isInternalRoute, isPlotSummaryRoute } from '../constants/routes.js';
import { AppError } from '../errors/app-error.js';

/**
 * Hook to block forbidden or internal routes at Gateway boundary:
 * 1. Blocks /internal/** completely -> returns 404 NOT_FOUND (BA - SOA.md §4, §15)
 * 2. Blocks GET /api/v1/plots/:plotId/summary -> returns 403 FORBIDDEN (BA - SOA.md §15)
 */
export async function routeGuardHook(request: FastifyRequest): Promise<void> {
  const url = request.raw.url || request.url;
  const method = request.method;

  // 1. Chặn route nội bộ
  if (isInternalRoute(url)) {
    throw AppError.notFound('Route not found');
  }

  // 2. Chặn route tóm tắt Plot dành riêng cho Trading Service
  if (isPlotSummaryRoute(method, url)) {
    throw AppError.forbidden('Direct access to plot summary is forbidden');
  }
}
