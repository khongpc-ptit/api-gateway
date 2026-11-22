import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { PublicKeyStore } from '../../src/config/public-keys.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { DummyAccessStateClient } from '../helpers/mock-user-service.js';
import {
  generateRsaKeyPair,
  signTestJwt,
  TEST_KEY_PAIR_1,
  TEST_KEY_PAIR_2,
} from '../helpers/token-helper.js';

describe('JWT RS256 Verification & Multi-kid Tests (BA - SOA.md §4, §16, §17, §19)', () => {
  const publicKeyStore = new PublicKeyStore();
  publicKeyStore.addKey('test-kid-1', TEST_KEY_PAIR_1.publicKeyPem);
  publicKeyStore.addKey('test-kid-2', TEST_KEY_PAIR_2.publicKeyPem);

  const app = buildApp({
    logger: false,
    publicKeyStore,
    accessStateClient: new DummyAccessStateClient(),
  });

  // Add dummy protected and public endpoints for verification
  app.get('/api/v1/users/me', async (request, reply) => {
    return reply.send({ user: request.user });
  });

  app.post('/api/v1/auth/login', async (_request, reply) => {
    return reply.send({ message: 'Login public endpoint reached' });
  });

  app.post('/api/v1/auth/register', async (_request, reply) => {
    return reply.send({ message: 'Register public endpoint reached' });
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    return reply.send({ message: 'Logout protected endpoint reached', user: request.user });
  });

  it('TC-AUTH-01: Public routes bypass JWT verification completely', async () => {
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
    });
    expect(resLogin.statusCode).toBe(200);

    const resRegister = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
    });
    expect(resRegister.statusCode).toBe(200);
  });

  it('TC-AUTH-02: POST /api/v1/auth/logout is PROTECTED and requires valid JWT', async () => {
    // Calling logout without token must fail with 401
    const resMissing = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });
    expect(resMissing.statusCode).toBe(401);
    const body = JSON.parse(resMissing.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);

    // Calling logout with valid token must succeed
    const validToken = signTestJwt({ kid: 'test-kid-1' });
    const resValid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });
    expect(resValid.statusCode).toBe(200);
    expect(JSON.parse(resValid.body).message).toBe('Logout protected endpoint reached');
  });

  it('TC-AUTH-03: Protected route without Authorization header returns 401 UNAUTHORIZED', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain('Missing Authorization header');
  });

  it('TC-AUTH-04: Non-Bearer scheme returns 401 UNAUTHORIZED', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: {
        authorization: 'Basic dXNlcjpwYXNz',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain('Bearer scheme');
  });

  it('TC-AUTH-05: Token with algorithm other than RS256 is rejected with 401', async () => {
    // Sign with HS256 (symmetric key)
    const tokenHs256 = jwt.sign(
      { sub: '11111111-1111-4111-8111-111111111111', role: 'FARMER' },
      'secret-key',
      { algorithm: 'HS256', keyid: 'test-kid-1' }
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: {
        authorization: `Bearer ${tokenHs256}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain('RS256 required');
  });

  it('TC-AUTH-06: Token missing kid header returns 401 UNAUTHORIZED', async () => {
    const tokenNoKid = jwt.sign(
      { sub: '11111111-1111-4111-8111-111111111111', role: 'FARMER' },
      TEST_KEY_PAIR_1.privateKeyPem,
      { algorithm: 'RS256', issuer: 'urn:soa:user-service', audience: 'soa-api' }
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: {
        authorization: `Bearer ${tokenNoKid}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain('missing key identifier (kid)');
  });

  it('TC-AUTH-07: Token with unknown kid returns 401 UNAUTHORIZED', async () => {
    const tokenUnknownKid = signTestJwt({ kid: 'unknown-kid-999' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: {
        authorization: `Bearer ${tokenUnknownKid}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain("Unknown Key ID: 'unknown-kid-999'");
  });

  it('TC-AUTH-08: Token with mismatched RSA signature returns 401 UNAUTHORIZED', async () => {
    // Sign with a foreign RSA key that doesn't match public key of kid-1
    const foreignKey = generateRsaKeyPair();
    const forgedToken = signTestJwt({
      kid: 'test-kid-1',
      privateKey: foreignKey.privateKeyPem,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: {
        authorization: `Bearer ${forgedToken}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain('verification failed');
  });

  it('TC-AUTH-09: Token with wrong issuer or audience returns 401 UNAUTHORIZED', async () => {
    const wrongIssToken = signTestJwt({ issuer: 'wrong-issuer' });
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${wrongIssToken}` },
    });
    expect(res1.statusCode).toBe(401);

    const wrongAudToken = signTestJwt({ audience: 'wrong-audience' });
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${wrongAudToken}` },
    });
    expect(res2.statusCode).toBe(401);
  });

  it('TC-AUTH-10: Token expired beyond 60s clock skew returns 401 UNAUTHORIZED', async () => {
    // Expired 120 seconds ago
    const expiredToken = signTestJwt({ expiresIn: -120 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(body.message).toContain('Token has expired');
  });

  it('TC-AUTH-11: Token expired within 60s clock skew is tolerated and accepted (§19)', async () => {
    // Expired 20 seconds ago (< 60s clock tolerance)
    const slightlyExpiredToken = signTestJwt({ expiresIn: -20 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${slightlyExpiredToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.user).toBeDefined();
    expect(body.user.role).toBe('FARMER');
  });

  it('TC-AUTH-12: Multi-kid Key Rotation overlap: both kid-1 and kid-2 succeed', async () => {
    const tokenKey1 = signTestJwt({
      kid: 'test-kid-1',
      privateKey: TEST_KEY_PAIR_1.privateKeyPem,
      role: 'FARMER',
    });

    const tokenKey2 = signTestJwt({
      kid: 'test-kid-2',
      privateKey: TEST_KEY_PAIR_2.privateKeyPem,
      role: 'TRADER',
    });

    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${tokenKey1}` },
    });
    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.body).user.role).toBe('FARMER');

    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${tokenKey2}` },
    });
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body).user.role).toBe('TRADER');
  });

  it('Attaches verified user identity claims to request.user', async () => {
    const accountId = '22222222-2222-4222-8222-222222222222';
    const token = signTestJwt({
      accountId,
      role: 'ADMIN',
      kid: 'test-kid-1',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.user.accountId).toBe(accountId);
    expect(body.user.role).toBe('ADMIN');
    expect(body.user.jti).toBe('test-jti-uuid');
    expect(body.user.exp).toBeDefined();
    expect(body.user.iat).toBeDefined();
  });
});
