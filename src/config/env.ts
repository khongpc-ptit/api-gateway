import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file into process.env
dotenv.config();

export const EnvSchema = z.object({
  // Server Configuration
  SERVER_PORT: z.coerce.number().default(8080),
  SERVER_HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // CORS Configuration (BA - SOA.md §17)
  PUBLIC_APP_ORIGIN: z.string().url().default('http://localhost:5173'),

  // JWT Configuration (BA - SOA.md §4, §19)
  JWT_ISSUER: z.string().default('urn:soa:user-service'),
  JWT_AUDIENCE: z.string().default('soa-api'),
  JWT_CLOCK_SKEW_SECONDS: z.coerce.number().default(60),
  JWT_PUBLIC_KEYS_JSON: z
    .string()
    .refine((val) => {
      try {
        const parsed = JSON.parse(val);
        return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0;
      } catch {
        return false;
      }
    }, 'JWT_PUBLIC_KEYS_JSON must be a valid non-empty JSON string mapping kid to PEM key')
    .default('{"dev-key-1":"-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4CHB+xZeYybKNJZn3vOF\\nbBBbfLvMW92u/eiNla+SYi/4WGyL74CGdPqx3qHaJ4/3ubQyOyPFBw5xlwLUpjG5\\n3/7e5Y8LnIGZoL38O+o85udfuuvUWVoLs3r846xTCZPJTTRTtXfHtZEwaVa3Lwc1\\nbUX5AvyVeO+M5eiWRQscO4zE1bVW6bVYBg5wQeLEtXp3KRMstJeOZk297gpPdElO\\nzqbYYvI8QQB8rcCE7BlAYfvyqWhGnSjT7t2K6i4s1JgjscWfQhKkp6dgs3IqYqX/\\n+NjCnXlLHhn6nshev0wKBjb2TS7mePNN48P4M8a3D0yeQO7oF8CK8/v+hSm+Hod4\\n4wIDAQAB\\n-----END PUBLIC KEY-----\\n"}'),

  // Upstream Services URLs (BA - SOA.md §15, §19)
  USER_SERVICE_URL: z.string().url().default('http://localhost:8081'),
  FARMING_SERVICE_URL: z.string().url().default('http://localhost:8082'),
  TRADING_SERVICE_URL: z.string().url().default('http://localhost:8083'),
  CHAT_SERVICE_URL: z.string().url().default('http://localhost:8084'),
  CHAT_SERVICE_WS_URL: z.string().default('ws://localhost:8084'),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:8085'),
  NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:8086'),

  // Inter-Service Security
  GATEWAY_TO_USER_SERVICE_KEY: z.string().min(16).default('gateway-to-user-secret-key-32chars-min'),
  ACCESS_STATE_TIMEOUT_MS: z.coerce.number().default(1000),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let cachedEnv: EnvConfig | null = null;

export function loadEnv(override?: Record<string, unknown>): EnvConfig {
  if (override) {
    return EnvSchema.parse({ ...process.env, ...override });
  }
  if (!cachedEnv) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Environment validation failed:', JSON.stringify(result.error.format(), null, 2));
      throw new Error('Invalid environment configuration');
    }
    cachedEnv = result.data;
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
