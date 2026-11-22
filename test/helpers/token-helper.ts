import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateRsaKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

// Generate shared test key pairs
export const TEST_KEY_PAIR_1 = generateRsaKeyPair();
export const TEST_KEY_PAIR_2 = generateRsaKeyPair();

export interface SignTokenOptions {
  accountId?: string;
  role?: 'FARMER' | 'TRADER' | 'ADMIN';
  kid?: string;
  privateKey?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  algorithm?: jwt.Algorithm;
}

export function signTestJwt(options: SignTokenOptions = {}): string {
  const {
    accountId = '11111111-1111-4111-8111-111111111111',
    role = 'FARMER',
    kid = 'test-kid-1',
    privateKey = TEST_KEY_PAIR_1.privateKeyPem,
    issuer = 'urn:soa:user-service',
    audience = 'soa-api',
    expiresIn = '15m',
    algorithm = 'RS256',
  } = options;

  const payload = {
    sub: accountId,
    role,
    jti: 'test-jti-uuid',
  };

  return jwt.sign(payload, privateKey, {
    algorithm,
    keyid: kid,
    issuer,
    audience,
    expiresIn,
  });
}
