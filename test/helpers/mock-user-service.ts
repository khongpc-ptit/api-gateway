import http from 'http';
import { AddressInfo } from 'net';
import { loadEnv } from '../../src/config/env.js';
import { AccessStateClient, AccessStateResult } from '../../src/services/access-state.client.js';

/**
 * A dummy client for test suites focusing on other concerns (e.g. JWT verification, routing)
 * that simulates an active user response without needing an HTTP server.
 */
export class DummyAccessStateClient extends AccessStateClient {
  constructor() {
    super(loadEnv());
  }

  override async checkAccessState(accountId: string, _traceId: string): Promise<AccessStateResult> {
    return {
      accountId,
      status: 'ACTIVE',
      role: 'FARMER',
      accessAllowed: true,
    };
  }
}

export interface MockAccountState {
  accountId?: string;
  status: string;
  role: string;
  accessAllowed: boolean;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  accountId?: string;
}

export class MockUserService {
  private server: http.Server;
  private accounts: Map<string, MockAccountState> = new Map();
  private defaultState: MockAccountState = {
    status: 'ACTIVE',
    role: 'FARMER',
    accessAllowed: true,
  };
  private delayMs = 0;
  private forcedErrorCode: number | null = null;
  private recordedRequests: RecordedRequest[] = [];

  constructor() {
    this.server = http.createServer((req, res) => {
      const url = req.url || '';
      const method = req.method || 'GET';

      // Parse accountId from URL: /internal/v1/accounts/:accountId/access-state
      const match = url.match(/^\/internal\/v1\/accounts\/([^/]+)\/access-state/);
      const accountId = match ? match[1] : undefined;

      this.recordedRequests.push({
        url,
        method,
        headers: req.headers,
        accountId,
      });

      const executeResponse = () => {
        if (this.forcedErrorCode) {
          res.writeHead(this.forcedErrorCode, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Mock user service error' }));
        }

        if (url.startsWith('/api/v1/')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'User service mock response', url }));
        }

        if (!accountId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Account not found' }));
        }

        const state = this.accounts.get(accountId) || { ...this.defaultState, accountId };
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            accountId,
            status: state.status,
            role: state.role,
            accessAllowed: state.accessAllowed,
          })
        );
      };

      if (this.delayMs > 0) {
        setTimeout(executeResponse, this.delayMs);
      } else {
        executeResponse();
      }
    });
  }

  public setAccountState(accountId: string, state: MockAccountState): void {
    this.accounts.set(accountId, state);
  }

  public setDefaultState(state: MockAccountState): void {
    this.defaultState = state;
  }

  public setDelay(ms: number): void {
    this.delayMs = ms;
  }

  public setErrorCode(code: number | null): void {
    this.forcedErrorCode = code;
  }

  public getRecordedRequests(): RecordedRequest[] {
    return this.recordedRequests;
  }

  public clearRecordedRequests(): void {
    this.recordedRequests = [];
  }

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as AddressInfo;
        resolve(addr.port);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
