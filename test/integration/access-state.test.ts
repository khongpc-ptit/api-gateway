import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { AccessStateClient } from '../../src/services/access-state.client.js';
import { MockUserService } from '../helpers/mock-user-service.js';
import { signTestJwt, TEST_KEY_PAIR_1 } from '../helpers/token-helper.js';

describe('Real-time Access-State Enforcement Tests (BA - SOA.md §4, §16, §19)', () => {
  let mockUserService: MockUserService;
  let userPort: number;
  let accessStateClient: AccessStateClient;
  let app: ReturnType<typeof buildApp>;

  const defaultEnv = loadEnv();
  const publicKeyStore = new PublicKeyStore();
  publicKeyStore.addKey('test-kid-1', TEST_KEY_PAIR_1.publicKeyPem);

  beforeAll(async () => {
    mockUserService = new MockUserService();
    userPort = await mockUserService.start();

    // Create custom env pointing to mock User Service
    const testEnv = loadEnv({
      USER_SERVICE_URL: `http://127.0.0.1:${userPort}`,
      ACCESS_STATE_TIMEOUT_MS: 1000,
      GATEWAY_TO_USER_SERVICE_KEY: 'test-gateway-to-user-service-key-32ch',
    });

    accessStateClient = new AccessStateClient(testEnv);
    app = buildApp(
      {
        logger: false,
        publicKeyStore,
        accessStateClient,
      },
      testEnv
    );

    // Dummy test routes
    app.get('/api/v1/plots/my-plots', async (request, reply) => {
      return reply.send({ plots: [], user: request.user });
    });

    app.post('/api/v1/auth/login', async (_request, reply) => {
      return reply.send({ message: 'Login successful' });
    });
  });

  afterAll(async () => {
    await mockUserService.stop();
  });

  beforeEach(() => {
    mockUserService.clearRecordedRequests();
    mockUserService.setDelay(0);
    mockUserService.setErrorCode(null);
  });

  it('TC-STATE-01: Allows request when account is ACTIVE and accessAllowed is true', async () => {
    const accountId = '33333333-3333-4333-8333-333333333333';
    mockUserService.setAccountState(accountId, {
      accountId,
      status: 'ACTIVE',
      role: 'FARMER',
      accessAllowed: true,
    });

    const token = signTestJwt({ accountId, kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.user.accountId).toBe(accountId);

    // Verify User Service received correct headers
    const requests = mockUserService.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['x-service-key']).toBe('test-gateway-to-user-service-key-32ch');
    expect(requests[0].headers['x-request-id']).toBeDefined();
    expect(requests[0].accountId).toBe(accountId);
  });

  it('TC-STATE-02: Rejects request with 403 ACCOUNT_NOT_ACTIVE when account is LOCKED', async () => {
    const accountId = '44444444-4444-4444-8444-444444444444';
    mockUserService.setAccountState(accountId, {
      accountId,
      status: 'LOCKED',
      role: 'FARMER',
      accessAllowed: false,
    });

    const token = signTestJwt({ accountId, kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCOUNT_NOT_ACTIVE);
    expect(body.message).toContain('LOCKED');
    expect(body.path).toBe('/api/v1/plots/my-plots');
    expect(body.traceId).toBeDefined();
  });

  it('TC-STATE-03: Rejects request with 403 ACCOUNT_NOT_ACTIVE when account is INACTIVE', async () => {
    const accountId = '55555555-5555-4555-8555-555555555555';
    mockUserService.setAccountState(accountId, {
      accountId,
      status: 'INACTIVE',
      role: 'TRADER',
      accessAllowed: false,
    });

    const token = signTestJwt({ accountId, kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCOUNT_NOT_ACTIVE);
    expect(body.message).toContain('INACTIVE');
  });

  it('TC-STATE-04: Rejects request with 403 ACCOUNT_NOT_ACTIVE when account is UNVERIFIED', async () => {
    const accountId = '66666666-6666-4666-8666-666666666666';
    mockUserService.setAccountState(accountId, {
      accountId,
      status: 'UNVERIFIED',
      role: 'FARMER',
      accessAllowed: false,
    });

    const token = signTestJwt({ accountId, kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCOUNT_NOT_ACTIVE);
    expect(body.message).toContain('UNVERIFIED');
  });

  it('TC-STATE-05: Rejects request with 403 when status is ACTIVE but accessAllowed is false', async () => {
    const accountId = '77777777-7777-4777-8777-777777777777';
    mockUserService.setAccountState(accountId, {
      accountId,
      status: 'ACTIVE',
      role: 'FARMER',
      accessAllowed: false,
    });

    const token = signTestJwt({ accountId, kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCOUNT_NOT_ACTIVE);
  });

  it('TC-STATE-06: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service times out (>1000ms)', async () => {
    const accountId = '88888888-8888-4888-8888-888888888888';
    mockUserService.setAccountState(accountId, {
      accountId,
      status: 'ACTIVE',
      role: 'FARMER',
      accessAllowed: true,
    });
    // Set delay longer than timeout (1200ms > 1000ms)
    mockUserService.setDelay(1200);

    const token = signTestJwt({ accountId, kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCESS_STATE_UNAVAILABLE);
    expect(body.message).toContain('timed out');
    expect(body.path).toBe('/api/v1/plots/my-plots');
    expect(body.traceId).toBeDefined();
  });

  it('TC-STATE-07: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service is down (connection refused)', async () => {
    // Point to a closed port on 127.0.0.1
    const offlineEnv = loadEnv({
      USER_SERVICE_URL: 'http://127.0.0.1:59999',
      ACCESS_STATE_TIMEOUT_MS: 500,
    });
    const offlineClient = new AccessStateClient(offlineEnv);
    const offlineApp = buildApp(
      {
        logger: false,
        publicKeyStore,
        accessStateClient: offlineClient,
      },
      offlineEnv
    );

    offlineApp.get('/api/v1/plots/my-plots', async () => ({ ok: true }));

    const token = signTestJwt({ kid: 'test-kid-1' });
    const response = await offlineApp.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCESS_STATE_UNAVAILABLE);
    expect(body.message).toContain('unreachable');
  });

  it('TC-STATE-08: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service returns 500 error', async () => {
    mockUserService.setErrorCode(500);

    const token = signTestJwt({ kid: 'test-kid-1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/my-plots',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.ACCESS_STATE_UNAVAILABLE);
    expect(body.message).toContain('returned status 500');
  });

  it('TC-STATE-09: Public routes bypass access-state check completely', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
    });

    expect(response.statusCode).toBe(200);
    // Ensure no calls were made to User Service
    expect(mockUserService.getRecordedRequests()).toHaveLength(0);
  });
});
