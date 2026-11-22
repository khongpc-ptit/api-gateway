import { describe, expect, it } from 'vitest';
import { EnvSchema, loadEnv } from '../../src/config/env.js';

describe('Environment Configuration (Zod Validation)', () => {
  it('should load default configuration successfully', () => {
    const config = loadEnv();
    expect(config.SERVER_PORT).toBe(8080);
    expect(config.SERVER_HOST).toBe('0.0.0.0');
    expect(['development', 'test']).toContain(config.NODE_ENV);
    expect(config.JWT_ISSUER).toBe('urn:soa:user-service');
    expect(config.JWT_AUDIENCE).toBe('soa-api');
    expect(config.JWT_CLOCK_SKEW_SECONDS).toBe(60);
    expect(config.ACCESS_STATE_TIMEOUT_MS).toBe(1000);
  });

  it('should validate valid custom environment variables', () => {
    const custom = {
      SERVER_PORT: '9000',
      SERVER_HOST: '127.0.0.1',
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      PUBLIC_APP_ORIGIN: 'https://app.example.com',
      JWT_PUBLIC_KEYS_JSON: '{"key-1":"fake-pem-key"}',
      GATEWAY_TO_USER_SERVICE_KEY: 'super-secret-key-that-is-long-enough',
      ACCESS_STATE_TIMEOUT_MS: '2000',
    };

    const parsed = EnvSchema.parse(custom);
    expect(parsed.SERVER_PORT).toBe(9000);
    expect(parsed.SERVER_HOST).toBe('127.0.0.1');
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.PUBLIC_APP_ORIGIN).toBe('https://app.example.com');
    expect(parsed.ACCESS_STATE_TIMEOUT_MS).toBe(2000);
  });

  it('should reject invalid CORS origin URL', () => {
    const custom = {
      PUBLIC_APP_ORIGIN: 'not-a-valid-url',
    };
    const result = EnvSchema.safeParse(custom);
    expect(result.success).toBe(false);
  });

  it('should reject invalid JWT_PUBLIC_KEYS_JSON format', () => {
    const custom = {
      JWT_PUBLIC_KEYS_JSON: 'invalid-json-string',
    };
    const result = EnvSchema.safeParse(custom);
    expect(result.success).toBe(false);
  });

  it('should reject short GATEWAY_TO_USER_SERVICE_KEY', () => {
    const custom = {
      GATEWAY_TO_USER_SERVICE_KEY: 'short',
    };
    const result = EnvSchema.safeParse(custom);
    expect(result.success).toBe(false);
  });
});
