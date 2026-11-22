import { request as undiciRequest } from 'undici';
import { EnvConfig } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

export interface AccessStateResult {
  accountId: string;
  status: 'ACTIVE' | 'LOCKED' | 'INACTIVE' | 'UNVERIFIED' | string;
  role: string;
  accessAllowed: boolean;
}

/**
 * HTTP Client to check real-time account access state from User Service
 * according to BA - SOA.md §4:
 * - GET /internal/v1/accounts/{accountId}/access-state
 * - X-Service-Key and X-Request-Id headers
 * - Hard timeout of 1000ms (AbortSignal.timeout)
 * - Fail-closed:
 *   • Timeout / Unreachable / 5xx -> 503 ACCESS_STATE_UNAVAILABLE
 *   • LOCKED / INACTIVE / UNVERIFIED / accessAllowed=false -> 403 ACCOUNT_NOT_ACTIVE
 */
export class AccessStateClient {
  constructor(private readonly env: EnvConfig) {}

  async checkAccessState(accountId: string, traceId: string): Promise<AccessStateResult> {
    const url = `${this.env.USER_SERVICE_URL}/internal/v1/accounts/${accountId}/access-state`;

    try {
      const response = await undiciRequest(url, {
        method: 'GET',
        headers: {
          'x-service-key': this.env.GATEWAY_TO_USER_SERVICE_KEY,
          'x-request-id': traceId,
        },
        signal: AbortSignal.timeout(this.env.ACCESS_STATE_TIMEOUT_MS),
      });

      if (response.statusCode !== 200) {
        // Drain body to keep socket healthy
        await response.body.dump();
        throw AppError.accessStateUnavailable(
          `User service access-state returned status ${response.statusCode}`
        );
      }

      const data = (await response.body.json()) as AccessStateResult;

      if (!data || typeof data !== 'object') {
        throw AppError.accessStateUnavailable('User service returned invalid access-state payload');
      }

      // BA - SOA.md §4: LOCKED/INACTIVE/UNVERIFIED or accessAllowed === false -> 403 ACCOUNT_NOT_ACTIVE
      if (data.status !== 'ACTIVE' || data.accessAllowed !== true) {
        throw AppError.accountNotActive(
          `Account access not allowed: status is ${data.status}`
        );
      }

      return data;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      const error = err as Error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw AppError.accessStateUnavailable(
          `User service access-state verification timed out after ${this.env.ACCESS_STATE_TIMEOUT_MS}ms`
        );
      }

      throw AppError.accessStateUnavailable(
        `User service access-state verification unreachable: ${error.message}`
      );
    }
  }
}
