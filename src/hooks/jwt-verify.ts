import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { validate as validateUuid } from 'uuid';
import { EnvConfig } from '../config/env.js';
import { PublicKeyStore } from '../config/public-keys.js';
import { isPublicRoute } from '../constants/routes.js';
import { AppError } from '../errors/app-error.js';

export interface AuthUser {
  accountId: string;
  role: 'FARMER' | 'TRADER' | 'ADMIN';
  jti?: string;
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Creates the JWT verification hook for Fastify preHandler.
 * Enforces RS256, iss, aud, exp (with clockSkew 60s), and multi-kid support.
 */
export function createJwtVerifyHook(env: EnvConfig, publicKeyStore: PublicKeyStore) {
  return async function jwtVerifyHook(request: FastifyRequest): Promise<void> {
    const url = request.raw.url || request.url;
    const method = request.method;

    // 1. Skip verification for unmatched routes (let notFoundHandler return 404)
    if (!request.routeOptions?.url) {
      return;
    }

    // 2. Skip verification for public allowlist routes
    if (isPublicRoute(method, url)) {
      return;
    }

    // 2. Extract Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      throw AppError.unauthorized('Missing Authorization header');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('Authorization header must use Bearer scheme');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw AppError.unauthorized('Bearer token is empty');
    }

    // 3. Decode token header to inspect kid and alg
    const decodedComplete = jwt.decode(token, { complete: true });
    if (!decodedComplete || typeof decodedComplete !== 'object') {
      throw AppError.unauthorized('Malformed JWT token');
    }

    const { header } = decodedComplete;
    if (header.alg !== 'RS256') {
      throw AppError.unauthorized('Invalid token algorithm, RS256 required');
    }

    const kid = header.kid;
    if (!kid || typeof kid !== 'string') {
      throw AppError.unauthorized('Token header missing key identifier (kid)');
    }

    // 4. Retrieve public key for the specific kid from PublicKeyStore
    const publicKey = publicKeyStore.getKey(kid);
    if (!publicKey) {
      throw AppError.unauthorized(`Unknown Key ID: '${kid}'`);
    }

    // 5. Verify signature and claims (iss, aud, exp, clockSkew)
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        clockTolerance: env.JWT_CLOCK_SKEW_SECONDS,
      }) as jwt.JwtPayload;
    } catch (err) {
      const error = err as jwt.VerifyErrors;
      if (error.name === 'TokenExpiredError') {
        throw AppError.unauthorized('Token has expired');
      }
      throw AppError.unauthorized(`Token verification failed: ${error.message}`);
    }

    // 6. Validate subject and role claims
    if (!payload.sub || typeof payload.sub !== 'string' || !validateUuid(payload.sub)) {
      throw AppError.unauthorized('Invalid or missing subject claim (must be a valid UUID)');
    }

    const validRoles = ['FARMER', 'TRADER', 'ADMIN'] as const;
    if (!payload.role || !validRoles.includes(payload.role as (typeof validRoles)[number])) {
      throw AppError.unauthorized('Invalid or missing role claim in token');
    }

    // 7. Attach verified user identity to Fastify request context
    request.user = {
      accountId: payload.sub,
      role: payload.role as 'FARMER' | 'TRADER' | 'ADMIN',
      jti: payload.jti,
      iat: payload.iat,
      exp: payload.exp,
    };
  };
}
