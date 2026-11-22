import http from 'http';
import { AddressInfo } from 'net';

export interface UpstreamRecordedRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export class MockUpstreamService {
  private server: http.Server;
  private recordedRequests: UpstreamRecordedRequest[] = [];
  private customHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  constructor(handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
    this.customHandler = handler;
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        this.recordedRequests.push({
          url: req.url || '',
          method: req.method || 'GET',
          headers: req.headers,
          body,
        });

        if (this.customHandler) {
          return this.customHandler(req, res);
        }

        // Default mock response: echoes the URL and received headers
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            receivedUrl: req.url,
            method: req.method,
            authorization: req.headers['authorization'],
            traceId: req.headers['x-request-id'],
            bodyLength: body.length,
          })
        );
      });
    });
  }

  public getRecordedRequests(): UpstreamRecordedRequest[] {
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
