import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { DummyAccessStateClient } from '../helpers/mock-user-service.js';
import { MockUpstreamService } from '../helpers/mock-upstreams.js';
import { signTestJwt, TEST_KEY_PAIR_1 } from '../helpers/token-helper.js';

describe('Reverse Proxy Routing Matrix & Streaming Tests (BA - SOA.md §4, §15, §18)', () => {
  let userUpstream: MockUpstreamService;
  let farmingUpstream: MockUpstreamService;
  let tradingUpstream: MockUpstreamService;
  let chatUpstream: MockUpstreamService;
  let paymentUpstream: MockUpstreamService;
  let notifUpstream: MockUpstreamService;

  let app: ReturnType<typeof buildApp>;
  const publicKeyStore = new PublicKeyStore();
  publicKeyStore.addKey('test-kid-1', TEST_KEY_PAIR_1.publicKeyPem);

  const validToken = signTestJwt({
    accountId: '12345678-1234-4234-8234-123456789abc',
    role: 'FARMER',
    kid: 'test-kid-1',
  });

  beforeAll(async () => {
    userUpstream = new MockUpstreamService();
    farmingUpstream = new MockUpstreamService();
    tradingUpstream = new MockUpstreamService();
    chatUpstream = new MockUpstreamService();
    paymentUpstream = new MockUpstreamService();
    notifUpstream = new MockUpstreamService();

    const [uPort, fPort, tPort, cPort, pPort, nPort] = await Promise.all([
      userUpstream.start(),
      farmingUpstream.start(),
      tradingUpstream.start(),
      chatUpstream.start(),
      paymentUpstream.start(),
      notifUpstream.start(),
    ]);

    const testEnv = loadEnv({
      USER_SERVICE_URL: `http://127.0.0.1:${uPort}`,
      FARMING_SERVICE_URL: `http://127.0.0.1:${fPort}`,
      TRADING_SERVICE_URL: `http://127.0.0.1:${tPort}`,
      CHAT_SERVICE_URL: `http://127.0.0.1:${cPort}`,
      CHAT_SERVICE_WS_URL: `ws://127.0.0.1:${cPort}`,
      PAYMENT_SERVICE_URL: `http://127.0.0.1:${pPort}`,
      NOTIFICATION_SERVICE_URL: `http://127.0.0.1:${nPort}`,
    });

    app = buildApp(
      {
        logger: false,
        publicKeyStore,
        accessStateClient: new DummyAccessStateClient(),
      },
      testEnv
    );

    // Wait for Fastify plugins and proxy routes to mount
    await app.ready();
  });

  afterAll(async () => {
    await Promise.all([
      userUpstream.stop(),
      farmingUpstream.stop(),
      tradingUpstream.stop(),
      chatUpstream.stop(),
      paymentUpstream.stop(),
      notifUpstream.stop(),
    ]);
  });

  beforeEach(() => {
    userUpstream.clearRecordedRequests();
    farmingUpstream.clearRecordedRequests();
    tradingUpstream.clearRecordedRequests();
    chatUpstream.clearRecordedRequests();
    paymentUpstream.clearRecordedRequests();
    notifUpstream.clearRecordedRequests();
  });

  it('TC-PROXY-01: Proxies public auth route to User Service preserving path (Port 8081)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'farmer@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    const requests = userUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/auth/login');
    expect(requests[0].method).toBe('POST');
  });

  it('TC-PROXY-02: Proxies protected /listings to Trading Service with prefix and Bearer (Port 8083)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/listings?page=0&size=20',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const requests = tradingUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/listings?page=0&size=20');
    expect(requests[0].headers['authorization']).toBe(`Bearer ${validToken}`);
    expect(requests[0].headers['x-request-id']).toBeDefined();
  });

  it('TC-PROXY-03: Proxies protected /plots to Farming Service (Port 8082)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/plot-12345',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const requests = farmingUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/plots/plot-12345');
  });

  it('TC-PROXY-04: Proxies protected /conversations to Chat Service (Port 8084)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const requests = chatUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/conversations');
  });

  it('TC-PROXY-05: Proxies protected /payments to Payment Service (Port 8085)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/contracts',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
      payload: { offerId: 'offer-123' },
    });

    expect(response.statusCode).toBe(200);
    const requests = paymentUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/payments/contracts');
  });

  it('TC-PROXY-06: Proxies protected /notifications to Notification Service (Port 8086)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const requests = notifUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/notifications');
  });

  it('TC-PROXY-07: Route Guard blocks GET /plots/:id/summary before reaching Farming upstream', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/plots/d784a5a2-9b22-4974-bc55-e7bb46c75df2/summary',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.FORBIDDEN);
    // Farming Service must NEVER have received this request
    expect(farmingUpstream.getRecordedRequests()).toHaveLength(0);
  });

  it('TC-PROXY-08: Spoofed headers are stripped before proxying to upstream', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/listings',
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-user-id': 'attacker-user-id',
        'x-user-role': 'ADMIN',
        'x-service-key': 'attacker-stolen-service-key',
      },
    });

    expect(response.statusCode).toBe(200);
    const requests = tradingUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].headers['x-user-id']).toBeUndefined();
    expect(requests[0].headers['x-user-role']).toBeUndefined();
    expect(requests[0].headers['x-service-key']).toBeUndefined();
  });

  it('TC-MEDIA-01: Rejects upload exceeding 5 MiB with 413 PAYLOAD_TOO_LARGE (§18)', async () => {
    const sixMib = 6 * 1024 * 1024; // 6,291,456 bytes > 5 MiB limit
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: {
        authorization: `Bearer ${validToken}`,
        'content-type': 'image/jpeg',
        'content-length': String(sixMib),
      },
      payload: 'dummy-body',
    });

    expect(response.statusCode).toBe(413);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(body.message).toContain('exceeds maximum allowed limit of 5 MiB');
    // User Service must not have received this oversized request
    expect(userUpstream.getRecordedRequests()).toHaveLength(0);
  });

  it('TC-MEDIA-02: Streams valid upload (<= 5 MiB) through to upstream without buffering', async () => {
    const uploadPayload = 'JPEG_IMAGE_DATA_SAMPLE_STREAM';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      headers: {
        authorization: `Bearer ${validToken}`,
        'content-type': 'image/jpeg',
        'content-length': String(Buffer.byteLength(uploadPayload)),
      },
      payload: uploadPayload,
    });

    expect(response.statusCode).toBe(200);
    const requests = userUpstream.getRecordedRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/api/v1/users/me/avatar');
    expect(requests[0].body).toBe(uploadPayload);
  });

  it('TC-PROXY-09: Returns 503 DEPENDENCY_UNAVAILABLE when upstream service is offline', async () => {
    // Point notification service to an offline port
    const offlineEnv = loadEnv({
      NOTIFICATION_SERVICE_URL: 'http://127.0.0.1:59998',
    });

    const offlineApp = buildApp(
      {
        logger: false,
        publicKeyStore,
        accessStateClient: new DummyAccessStateClient(),
      },
      offlineEnv
    );
    await offlineApp.ready();

    const response = await offlineApp.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.DEPENDENCY_UNAVAILABLE);
    expect(body.message).toBe('Upstream dependency unavailable');
  });
});
