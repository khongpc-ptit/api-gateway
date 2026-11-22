/**
 * Route definitions and classification (BA - SOA.md §4, §15, §17)
 */

export interface RouteRule {
  method: string;
  path: string;
}

/**
 * Public routes that do not require JWT authentication or access-state check.
 * Note: POST /api/v1/auth/logout is explicitly PROTECTED per BA §4 & §17.
 */
export const PUBLIC_ROUTES: RouteRule[] = [
  { method: 'POST', path: '/api/v1/auth/register' },
  { method: 'POST', path: '/api/v1/auth/verify-otp' },
  { method: 'POST', path: '/api/v1/auth/resend-otp' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'POST', path: '/api/v1/auth/refresh' },
  { method: 'GET', path: '/health' },
];

/**
 * Helper to check whether a request is a public route.
 */
export function isPublicRoute(method: string, url: string): boolean {
  // Strip query string for path comparison
  const path = url.split('?')[0];
  return PUBLIC_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.path === path
  );
}

/**
 * Helper to check if a route is an internal endpoint that must be blocked.
 */
export function isInternalRoute(url: string): boolean {
  const path = url.split('?')[0];
  return path.startsWith('/internal/') || path === '/internal';
}

/**
 * Helper to check if a route is the special Trading-to-Farming snapshot endpoint
 * that must be rejected if invoked from public client (BA §15).
 * Match: GET /api/v1/plots/:plotId/summary
 */
const PLOT_SUMMARY_REGEX = /^\/api\/v1\/plots\/[^/]+\/summary$/i;

export function isPlotSummaryRoute(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const path = url.split('?')[0];
  return PLOT_SUMMARY_REGEX.test(path);
}
