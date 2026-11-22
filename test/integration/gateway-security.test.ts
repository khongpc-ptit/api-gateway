import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { DummyAccessStateClient } from '../helpers/mock-user-service.js';
import { signTestJwt, TEST_KEY_PAIR_1 } from '../helpers/token-helper.js';

describe('Gateway Edge Security Tests (BA - SOA.md §2, §4, §15, §17)', () => {
  const publicKeyStore = new PublicKeyStore();
  publicKeyStore.addKey('test-kid-1', TEST_KEY_PAIR_1.publicKeyPem);

  const app = buildApp({
    logger: false,
    publicKeyStore,
    accessStateClient: new DummyAccessStateClient(),
  });

  // Add dummy endpoint to inspect stripped headers
  app.get('/health/echo-headers', async (request, reply) => {
    return reply.send({
      userId: request.headers['x-user-id'],
      userRole: request.headers['x-user-role'],
      serviceKey: request.headers['x-service-key'],
      traceId: request.traceId,
    });
  });

  it('TC-SEC-01: Blocks internal endpoints (/internal/**) with 404 NOT_FOUND', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/internal/v1/accounts/123/access-state',
    });

    expect(res1.statusCode).toBe(404);
    const body1 = JSON.parse(res1.body);
    expect(body1.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(body1.message).toBe('Route not found');

    const res2 = await app.inject({
      method: 'POST',
      url: '/internal/v1/offers/123/deposit-commit',
    });

    expect(res2.statusCode).toBe(404);
    const body2 = JSON.parse(res2.body);
    expect(body2.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('TC-SEC-02: Blocks GET /api/v1/plots/:plotId/summary with 403 FORBIDDEN', async () => {
    const plotId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/plots/${plotId}/summary`,
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(body.message).toBe('Direct access to plot summary is forbidden');
    expect(body.path).toBe(`/api/v1/plots/${plotId}/summary`);
    expect(body.traceId).toBeDefined();
  });

  it('Does not block regular plot routes like GET /api/v1/plots/:plotId', async () => {
    const plotId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/plots/${plotId}`,
    });

    // It should pass routeGuard and reach 404 or auth check
    expect([401, 404]).toContain(response.statusCode);
  });

  it('TC-SEC-03: Strips spoofed client headers (x-user-id, x-user-role, x-service-key)', async () => {
    const validToken = signTestJwt({ kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/health/echo-headers',
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-user-id': 'spoofed-user-id-12345',
        'x-user-role': 'ADMIN',
        'x-service-key': 'attacker-service-key',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.userId).toBeUndefined();
    expect(body.userRole).toBeUndefined();
    expect(body.serviceKey).toBeUndefined();
    expect(body.traceId).toBeDefined();
  });

  it('TC-CORS-01: Handles CORS preflight for allowed origin (PUBLIC_APP_ORIGIN)', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/listings',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
  });

  it('TC-CORS-02: Rejects CORS preflight for unallowed origin', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/listings',
      headers: {
        origin: 'http://malicious-website.com',
        'access-control-request-method': 'POST',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
