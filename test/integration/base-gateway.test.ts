import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { AppError } from '../../src/errors/app-error.js';
import { DummyAccessStateClient } from '../helpers/mock-user-service.js';
import { signTestJwt, TEST_KEY_PAIR_1 } from '../helpers/token-helper.js';

describe('Base Gateway Integration Tests', () => {
  const publicKeyStore = new PublicKeyStore();
  publicKeyStore.addKey('test-kid-1', TEST_KEY_PAIR_1.publicKeyPem);

  const app = buildApp({
    logger: false,
    publicKeyStore,
    accessStateClient: new DummyAccessStateClient(),
  });
  const validAuthHeader = `Bearer ${signTestJwt({ kid: 'test-kid-1' })}`;

  // Add dummy routes to test error handling
  app.get('/test/app-error', async () => {
    throw AppError.unauthorized('Token is expired or invalid');
  });

  app.get('/test/forbidden-error', async () => {
    throw AppError.forbidden('Access denied to resource');
  });

  app.get('/test/account-not-active', async () => {
    throw AppError.accountNotActive('Account is LOCKED');
  });

  app.get('/test/unexpected-error', async () => {
    throw new Error('Database connection unexpectedly dropped');
  });

  app.post(
    '/test/validation-error',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      return reply.send({ success: true });
    }
  );

  it('GET /health returns 200 with service status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('UP');
    expect(body.service).toBe('api-gateway');
    expect(body.timestamp).toBeDefined();
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('Injects and validates X-Request-Id header correctly', async () => {
    const clientTraceId = '550e8400-e29b-41d4-a716-446655440000';
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': clientTraceId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(clientTraceId);
  });

  it('Generates new UUID when X-Request-Id is invalid', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': 'invalid-uuid-string',
      },
    });

    expect(response.statusCode).toBe(200);
    const generatedId = response.headers['x-request-id'];
    expect(generatedId).toBeDefined();
    expect(generatedId).not.toBe('invalid-uuid-string');
    // Verify standard UUID format
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('Returns standard Error Contract for unmatched routes (404 NOT_FOUND)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/non-existent-route',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      timestamp: expect.any(String),
      status: 404,
      code: ERROR_CODES.NOT_FOUND,
      message: 'Route not found',
      path: '/api/v1/non-existent-route',
      traceId: expect.any(String),
    });
  });

  it('Formats AppError.unauthorized into standard Error Contract (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test/app-error',
      headers: {
        authorization: validAuthHeader,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      timestamp: expect.any(String),
      status: 401,
      code: ERROR_CODES.UNAUTHORIZED,
      message: 'Token is expired or invalid',
      path: '/test/app-error',
      traceId: expect.any(String),
    });
  });

  it('Formats AppError.accountNotActive into standard Error Contract (403)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test/account-not-active',
      headers: {
        authorization: validAuthHeader,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      timestamp: expect.any(String),
      status: 403,
      code: ERROR_CODES.ACCOUNT_NOT_ACTIVE,
      message: 'Account is LOCKED',
      path: '/test/account-not-active',
      traceId: expect.any(String),
    });
  });

  it('Sanitizes unexpected 500 errors and does not expose stack trace or database info', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test/unexpected-error',
      headers: {
        authorization: validAuthHeader,
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      timestamp: expect.any(String),
      status: 500,
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      path: '/test/unexpected-error',
      traceId: expect.any(String),
    });
    // Ensure stack trace or original message is completely hidden
    expect(body.message).not.toContain('Database');
    expect(response.body).not.toContain('stack');
  });

  it('Formats Fastify schema validation error into standard 400 VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test/validation-error',
      headers: {
        authorization: validAuthHeader,
      },
      payload: {}, // Missing required 'name'
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(body.path).toBe('/test/validation-error');
    expect(body.traceId).toBeDefined();
  });
});
