import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { buildApp } from '../../src/app.js';
import { AccessStateClient } from '../../src/services/access-state.client.js';
import { MockUserService } from '../helpers/mock-user-service.js';
import { MockUpstreamService } from '../helpers/mock-upstreams.js';
import {
  TEST_KEY_PAIR_1,
  TEST_KEY_PAIR_2,
  signTestJwt,
} from '../helpers/token-helper.js';

describe('Comprehensive Acceptance Criteria Test Suite (BA - SOA.md §16 & Plan Part 6)', () => {
  let app: FastifyInstance;
  let mockUserService: MockUserService;
  let mockTradingService: MockUpstreamService;
  let mockFarmingService: MockUpstreamService;

  let userPort: number;
  let tradingPort: number;
  let farmingPort: number;

  const keyStore = new PublicKeyStore();
  keyStore.loadFromJson(
    JSON.stringify({
      'test-kid-1': TEST_KEY_PAIR_1.publicKeyPem,
      'test-kid-2': TEST_KEY_PAIR_2.publicKeyPem,
    })
  );

  beforeAll(async () => {
    // Start mock microservices
    mockUserService = new MockUserService();
    userPort = await mockUserService.start();

    mockTradingService = new MockUpstreamService();
    tradingPort = await mockTradingService.start();

    mockFarmingService = new MockUpstreamService();
    farmingPort = await mockFarmingService.start();

    const testEnv = loadEnv({
      USER_SERVICE_URL: `http://127.0.0.1:${userPort}`,
      FARMING_SERVICE_URL: `http://127.0.0.1:${farmingPort}`,
      TRADING_SERVICE_URL: `http://127.0.0.1:${tradingPort}`,
      CHAT_SERVICE_URL: `http://127.0.0.1:19994`,
      CHAT_SERVICE_WS_URL: `ws://127.0.0.1:19994`,
      PAYMENT_SERVICE_URL: `http://127.0.0.1:19995`, // intentionally unused port for 503 test
      NOTIFICATION_SERVICE_URL: `http://127.0.0.1:19996`,
      ACCESS_STATE_TIMEOUT_MS: 1000,
      GATEWAY_TO_USER_SERVICE_KEY: 'test-gateway-to-user-service-key-32ch',
    });

    const accessStateClient = new AccessStateClient(testEnv);

    // Build gateway application
    app = buildApp(
      {
        logger: false,
        publicKeyStore: keyStore,
        accessStateClient,
      },
      testEnv
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await mockUserService.stop();
    await mockTradingService.stop();
    await mockFarmingService.stop();
  });

  beforeEach(() => {
    mockUserService.clearRecordedRequests();
    mockUserService.setDelay(0);
    mockUserService.setErrorCode(null);
    mockTradingService.clearRecordedRequests();
    mockFarmingService.clearRecordedRequests();
  });

  // Helper to validate standard error contract JSON structure
  function assertErrorContract(
    body: any,
    expectedStatus: number,
    expectedCode: string,
    expectedPath: string
  ) {
    expect(body).toBeDefined();
    expect(body.status).toBe(expectedStatus);
    expect(body.code).toBe(expectedCode);
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.path).toBe(expectedPath);
    expect(body.traceId).toBeDefined();
    // Validate UUID format for traceId
    expect(body.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    // Validate ISO timestamp
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    // Ensure no sensitive leakage
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('sql');
  }

  // =========================================================================
  // GROUP 1: Edge Security & Route Guard (TC-SEC-01 -> TC-SEC-03)
  // =========================================================================
  describe('Group 1: Edge Security & Route Guard (BA §2, §4, §15)', () => {
    it('TC-SEC-01: Blocks /internal/** routes unconditionally with 404 NOT_FOUND', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/v1/accounts/11111111-1111-4111-8111-111111111111/access-state',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      assertErrorContract(
        body,
        404,
        ERROR_CODES.NOT_FOUND,
        '/internal/v1/accounts/11111111-1111-4111-8111-111111111111/access-state'
      );
    });

    it('TC-SEC-02: Blocks GET /api/v1/plots/:plotId/summary with 403 FORBIDDEN (§15)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots/plot-uuid-1234/summary',
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      assertErrorContract(
        body,
        403,
        ERROR_CODES.FORBIDDEN,
        '/api/v1/plots/plot-uuid-1234/summary'
      );
    });

    it('TC-SEC-03: Strips spoofed client headers (x-user-id, x-user-role, x-service-key) (§2, §4)', async () => {
      const accountId = '22222222-2222-4222-8222-222222222222';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/listings',
        headers: {
          authorization: `Bearer ${token}`,
          'x-user-id': 'spoofed-id',
          'x-user-role': 'ADMIN',
          'x-service-key': 'spoofed-key',
        },
      });

      expect(response.statusCode).toBe(200);
      const requests = mockTradingService.getRecordedRequests();
      expect(requests).toHaveLength(1);
      const forwardedHeaders = requests[0].headers;
      expect(forwardedHeaders['x-user-id']).toBeUndefined();
      expect(forwardedHeaders['x-user-role']).toBeUndefined();
      expect(forwardedHeaders['x-service-key']).toBeUndefined();
    });
  });

  // =========================================================================
  // GROUP 2: CORS Configuration (TC-CORS-01 -> TC-CORS-02)
  // =========================================================================
  describe('Group 2: CORS Configuration (BA §17)', () => {
    it('TC-CORS-01: Valid preflight OPTIONS request returns 204 with strict CORS headers', async () => {
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
      expect(response.headers['access-control-allow-credentials']).toBeUndefined(); // credentials: false per BA §17
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });

    it('TC-CORS-02: Disallowed origin does not receive Access-Control-Allow-Origin header', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/listings',
        headers: {
          origin: 'http://evil-attacker-site.com',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // =========================================================================
  // GROUP 3: Authentication & JWT RS256 Verification (TC-AUTH-01 -> TC-AUTH-08)
  // =========================================================================
  describe('Group 3: Authentication & JWT Verification (BA §4, §16.1, §17, §19)', () => {
    it('TC-AUTH-01: Public routes pass through without JWT (e.g. POST /api/v1/auth/login)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'user@example.com', password: 'secret' },
      });

      // Proxied to User Service upstream
      expect(response.statusCode).toBe(200);
    });

    it('TC-AUTH-02: POST /api/v1/auth/logout requires JWT; returns 401 when missing (§4, §17)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: 'dummy-refresh-token' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 401, ERROR_CODES.UNAUTHORIZED, '/api/v1/auth/logout');
    });

    it('TC-AUTH-03: Protected route returns 401 UNAUTHORIZED when Authorization header is missing (§16.1)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 401, ERROR_CODES.UNAUTHORIZED, '/api/v1/plots');
    });

    it('TC-AUTH-04: Returns 401 UNAUTHORIZED when token is expired beyond 60s clock skew (§16.1, §19)', async () => {
      // Expired 120s ago
      const expiredToken = signTestJwt({
        expiresIn: '-120s',
        kid: 'test-kid-1',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 401, ERROR_CODES.UNAUTHORIZED, '/api/v1/plots');
    });

    it('TC-AUTH-05: Permits token expired within 60s clock skew tolerance (30s ago) (§19)', async () => {
      const accountId = '33333333-3333-4333-8333-333333333333';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });

      // Expired 30 seconds ago (well within 60s clockSkew)
      const nearExpiredToken = signTestJwt({
        accountId,
        expiresIn: '-30s',
        kid: 'test-kid-1',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/listings',
        headers: {
          authorization: `Bearer ${nearExpiredToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('TC-AUTH-06: Returns 401 UNAUTHORIZED for wrong issuer or audience (§16.1)', async () => {
      const wrongIssuerToken = signTestJwt({
        issuer: 'urn:wrong:issuer',
        kid: 'test-kid-1',
      });

      const res1 = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${wrongIssuerToken}` },
      });
      expect(res1.statusCode).toBe(401);

      const wrongAudienceToken = signTestJwt({
        audience: 'wrong-audience',
        kid: 'test-kid-1',
      });

      const res2 = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${wrongAudienceToken}` },
      });
      expect(res2.statusCode).toBe(401);
    });

    it('TC-AUTH-07: Supports key rotation overlap: verifies tokens from both key-1 and key-2 (§19)', async () => {
      const accountId = '44444444-4444-4444-8444-444444444444';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });

      const token1 = signTestJwt({
        accountId,
        kid: 'test-kid-1',
        privateKey: TEST_KEY_PAIR_1.privateKeyPem,
      });

      const token2 = signTestJwt({
        accountId,
        kid: 'test-kid-2',
        privateKey: TEST_KEY_PAIR_2.privateKeyPem,
      });

      const res1 = await app.inject({
        method: 'GET',
        url: '/api/v1/listings',
        headers: { authorization: `Bearer ${token1}` },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'GET',
        url: '/api/v1/listings',
        headers: { authorization: `Bearer ${token2}` },
      });
      expect(res2.statusCode).toBe(200);
    });

    it('TC-AUTH-08: Returns 401 UNAUTHORIZED when kid is not found in key store (§19)', async () => {
      const unknownKidToken = signTestJwt({
        kid: 'unknown-nonexistent-kid',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${unknownKidToken}` },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 401, ERROR_CODES.UNAUTHORIZED, '/api/v1/plots');
    });
  });

  // =========================================================================
  // GROUP 4: Real-time Access-State Enforcement (TC-STATE-01 -> TC-STATE-05)
  // =========================================================================
  describe('Group 4: Real-time Access-State Enforcement (BA §4, §16.1, §16.2)', () => {
    it('TC-STATE-01: Permits request when account status is ACTIVE and accessAllowed is true (§4)', async () => {
      const accountId = '55555555-5555-4555-8555-555555555555';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/listings',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('TC-STATE-02: Returns 403 ACCOUNT_NOT_ACTIVE when account is LOCKED (§16.2)', async () => {
      const accountId = '66666666-6666-4666-8666-666666666666';
      mockUserService.setAccountState(accountId, { status: 'LOCKED', accessAllowed: false, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 403, ERROR_CODES.ACCOUNT_NOT_ACTIVE, '/api/v1/plots');
    });

    it('TC-STATE-03: Returns 403 ACCOUNT_NOT_ACTIVE when account is UNVERIFIED (§16.1)', async () => {
      const accountId = '77777777-7777-4777-8777-777777777777';
      mockUserService.setAccountState(accountId, { status: 'UNVERIFIED', accessAllowed: false, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 403, ERROR_CODES.ACCOUNT_NOT_ACTIVE, '/api/v1/plots');
    });

    it('TC-STATE-04: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service access-state times out (>1000ms) (§16.1)', async () => {
      const accountId = '88888888-8888-4888-8888-888888888888';
      mockUserService.setDelay(1100); // Exceeds 1000ms timeout
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 503, ERROR_CODES.ACCESS_STATE_UNAVAILABLE, '/api/v1/plots');
    });

    it('TC-STATE-05: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service returns 500 error (§16.1)', async () => {
      const accountId = '99999999-9999-4999-8999-999999999999';
      mockUserService.setErrorCode(500);
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      assertErrorContract(body, 503, ERROR_CODES.ACCESS_STATE_UNAVAILABLE, '/api/v1/plots');
    });
  });

  // =========================================================================
  // GROUP 5: Reverse Proxy & Media Streaming (TC-PROXY-01 -> TC-MEDIA-02)
  // =========================================================================
  describe('Group 5: Reverse Proxy & Media Streaming (BA §15, §18)', () => {
    it('TC-PROXY-01: Preserves /api/v1 prefix when proxying to upstream services (§15)', async () => {
      const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/listings?category=vegetables&sort=desc',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const requests = mockTradingService.getRecordedRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/api/v1/listings?category=vegetables&sort=desc');
    });

    it('TC-PROXY-02: Preserves Authorization: Bearer header when proxying to upstream (§4)', async () => {
      const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/plots/plot-999',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const requests = mockFarmingService.getRecordedRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].headers['authorization']).toBe(`Bearer ${token}`);
    });

    it('TC-MEDIA-01: Rejects payload with Content-Length > 5 MiB with 413 PAYLOAD_TOO_LARGE (§18)', async () => {
      const oversizedBytes = 5 * 1024 * 1024 + 1; // 5 MiB + 1 byte
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/listings/upload-images',
        headers: {
          'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW',
          'content-length': String(oversizedBytes),
        },
        payload: 'small-stub-payload',
      });

      expect(response.statusCode).toBe(413);
      const body = JSON.parse(response.body);
      assertErrorContract(
        body,
        413,
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        '/api/v1/listings/upload-images'
      );
    });

    it('TC-MEDIA-02: Streams valid upload (<= 5 MiB) through to upstream without buffering (§18)', async () => {
      const accountId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      mockUserService.setAccountState(accountId, { status: 'ACTIVE', accessAllowed: true, role: 'FARMER' });
      const token = signTestJwt({ accountId, kid: 'test-kid-1' });

      const payloadContent = 'image-binary-stream-sample-data';
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/listings/upload-images',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'image/jpeg',
          'content-length': String(Buffer.byteLength(payloadContent)),
        },
        payload: payloadContent,
      });

      expect(response.statusCode).toBe(200);
      const requests = mockTradingService.getRecordedRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toBe(payloadContent);
    });
  });

  // =========================================================================
  // GROUP 6: Error Contract Normalization & Defense (TC-ERR-01)
  // =========================================================================
  describe('Group 6: Error Contract Standardization & Information Disclosure Defense (BA §3, §10)', () => {
    it('TC-ERR-01: Verifies 100% adherence to standard Error Contract across 404, 401, 403, 413, 503', async () => {
      // 1. Check 404 NOT_FOUND
      const res404 = await app.inject({ method: 'GET', url: '/api/v1/non-existent-route' });
      expect(res404.statusCode).toBe(404);
      assertErrorContract(
        JSON.parse(res404.body),
        404,
        ERROR_CODES.NOT_FOUND,
        '/api/v1/non-existent-route'
      );

      // 2. Check 401 UNAUTHORIZED
      const res401 = await app.inject({ method: 'GET', url: '/api/v1/plots' });
      expect(res401.statusCode).toBe(401);
      assertErrorContract(JSON.parse(res401.body), 401, ERROR_CODES.UNAUTHORIZED, '/api/v1/plots');

      // 3. Check 403 FORBIDDEN
      const res403 = await app.inject({ method: 'GET', url: '/api/v1/plots/123/summary' });
      expect(res403.statusCode).toBe(403);
      assertErrorContract(
        JSON.parse(res403.body),
        403,
        ERROR_CODES.FORBIDDEN,
        '/api/v1/plots/123/summary'
      );

      // 4. Check 413 PAYLOAD_TOO_LARGE
      const res413 = await app.inject({
        method: 'POST',
        url: '/api/v1/listings',
        headers: { 'content-length': '6000000' },
      });
      expect(res413.statusCode).toBe(413);
      assertErrorContract(
        JSON.parse(res413.body),
        413,
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        '/api/v1/listings'
      );

      // 5. Check 503 for unavailable route (Payment Service mock port 19995 is offline)
      const token = signTestJwt({
        accountId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        kid: 'test-kid-1',
      });
      mockUserService.setAccountState('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {
        status: 'ACTIVE',
        accessAllowed: true,
        role: 'FARMER',
      });

      const res503 = await app.inject({
        method: 'GET',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res503.statusCode).toBe(503);
      assertErrorContract(
        JSON.parse(res503.body),
        503,
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        '/api/v1/payments'
      );
    });
  });
});
