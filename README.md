# Fastify API Gateway — Agriculture Management Platform (Port 8080)

Fastify API Gateway for the Agriculture Management Platform Microservices System, fully compliant with **BA - SOA.md (MVP Contract v2.1 baseline)**.

## 1. Technology Stack
- **Runtime:** Node.js (v20+ / v22-alpine)
- **Language:** TypeScript (strict mode, NodeNext module resolution)
- **Framework:** Fastify v5 (pure, high performance)
- **Reverse Proxy:** `@fastify/http-proxy` (v11.x)
- **Security & JWT:** RS256 JWT Verification with Multi-`kid` support for zero-downtime key rotation (>= 16 min overlap)
- **Access-State Enforcement:** Real-time synchronous access-state enforcement via User Service with hard 1000ms timeout (`undici` / `AbortSignal.timeout`) and fail-closed architecture
- **Validation:** Zod
- **Testing:** Vitest (80/80 integration & unit tests passing)
- **Containerization:** Multi-stage Docker build running under non-root `node` user

---

## 2. Architecture & Request Lifecycle

Incoming requests pass through a strictly ordered pipeline before reaching upstream microservices:
1. **Request ID Injection (`onRequest`):** Validates incoming `X-Request-Id` UUID or generates a new UUID v4 `traceId`. Sets `request.traceId`, propagates to `request.headers['x-request-id']`, and adds `X-Request-Id` response header.
2. **CORS Plugin (`onRequest`):** Strict origin checking against `PUBLIC_APP_ORIGIN` (`http://localhost:5173` in dev). Disallows wildcards, sets `credentials: false`, handles `OPTIONS` preflight with 204.
3. **Payload Limit Hook (`onRequest`):** Inspects `Content-Length`. Immediately rejects uploads exceeding 5 MiB (5,242,880 bytes) with `413 PAYLOAD_TOO_LARGE` (§18) without buffering.
4. **Header Sanitization Hook (`onRequest`):** Strips spoofed client headers (`x-user-id`, `x-user-role`, `x-service-key`) before request enters processing.
5. **Route Guard Hook (`onRequest`):** Churns edge route defense:
   - Blocks all internal routes (`/internal/**`) with `404 NOT_FOUND`.
   - Blocks direct access to plot summary (`GET /api/v1/plots/:plotId/summary`) with `403 FORBIDDEN`.
6. **JWT RS256 Verification Hook (`preHandler`):**
   - Public routes (`/api/v1/auth/login`, `/api/v1/auth/register`, `/health`, etc.) bypass auth.
   - Protected routes (and `POST /api/v1/auth/logout`) require valid RS256 JWT. Validates `iss=urn:soa:user-service`, `aud=soa-api`, expiration with 60s clock tolerance, and matches Key ID (`kid`) from in-memory key store.
7. **Real-time Access-State Hook (`preHandler`):**
   - Synchronously calls `GET /internal/v1/accounts/:accountId/access-state` on User Service (Port 8081).
   - Hard timeout 1000ms.
   - Never caches `ACTIVE` status.
   - Fail-closed: `LOCKED`/`INACTIVE`/`UNVERIFIED` returns `403 ACCOUNT_NOT_ACTIVE`. Downstream timeout or error returns `503 ACCESS_STATE_UNAVAILABLE`.
8. **Reverse Proxying:**
   - Preserves `/api/v1/...` prefix (`rewritePrefix: route.prefix`).
   - Forwards `Authorization: Bearer <token>` and `X-Request-Id`.
   - Streams multipart upload directly without buffering.
   - Proxies WebSocket connections for Chat Service (`/ws/chat`).

---

## 3. Microservice Routing Matrix

| Public Path Prefix | Target Microservice | Port | Protocol | Notes |
|:---|:---|:---:|:---:|:---|
| `/api/v1/auth` | User Service | `8081` | REST | Public (login/register) & Protected (logout) |
| `/api/v1/users` | User Service | `8081` | REST | Protected |
| `/api/v1/farmers` | User Service | `8081` | REST | Protected |
| `/api/v1/traders` | User Service | `8081` | REST | Protected |
| `/api/v1/admin/accounts` | User Service | `8081` | REST | Protected (Admin) |
| `/api/v1/plots` | Farming Service | `8082` | REST | Protected (`/summary` blocked) |
| `/api/v1/crop-seasons` | Farming Service | `8082` | REST | Protected |
| `/api/v1/logs` | Farming Service | `8082` | REST | Protected |
| `/api/v1/costs` | Farming Service | `8082` | REST | Protected |
| `/api/v1/listings` | Trading Service | `8083` | REST | Protected (Upload ≤ 5 MiB streamed) |
| `/api/v1/offers` | Trading Service | `8083` | REST | Protected |
| `/api/v1/conversations` | Chat Service | `8084` | REST | Protected |
| `/ws/chat` | Chat Service | `8084` | WebSocket | Proxied upgrade |
| `/api/v1/payments` | Payment Service | `8085` | REST | Protected |
| `/api/v1/notifications` | Notification Service | `8086` | REST | Protected |

---

## 4. Standard Error Contract

All error responses strictly comply with the Contract v2.1 baseline format (§3 & §10):
```json
{
  "timestamp": "2026-11-22T07:30:46.000Z",
  "status": 401,
  "code": "UNAUTHORIZED",
  "message": "Token expired or invalid",
  "path": "/api/v1/plots",
  "traceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```
Stack traces, internal hostnames, and database details are never leaked.

---

## 5. Getting Started

### 5.1. Local Development
```bash
# 1. Clone repository
git clone https://github.com/khongpc-ptit/api-gateway.git
cd api-gateway

# 2. Configure environment
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Run in dev mode (hot reload)
npm run dev
```

### 5.2. Build and Test
```bash
# Compile TypeScript
npm run build

# Run Vitest test suite (80 test cases)
npm test
```

### 5.3. Docker
```bash
# Build Docker image
docker build -t api-gateway:latest .

# Run Docker container
docker run -d \
  -p 8080:8080 \
  --env-file .env \
  --name api-gateway \
  api-gateway:latest
```

---

## 6. Implementation Reports
- [Phase 1: Project Setup & Baseline Architecture](reports/phase-1-report.md)
- [Phase 2: Edge Security, CORS & JWT RS256 Multi-kid](reports/phase-2-report.md)
- [Phase 3: Real-time Access-State Enforcement](reports/phase-3-report.md)
- [Phase 4: Reverse Proxy, Streaming & WebSocket](reports/phase-4-report.md)
- [Phase 5: Full Acceptance Test Suite](reports/phase-5-report.md)
- [Phase 6: Dockerization & Production Readiness](reports/phase-6-report.md)
