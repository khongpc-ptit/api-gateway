# KẾ HOẠCH TRIỂN KHAI CHI TIẾT (IMPLEMENTATION PLAN)
## FASTIFY API GATEWAY — AGRICULTURE MANAGEMENT PLATFORM (PORT 8080)

> **Tài liệu căn cứ:** `BA - SOA.md` (Contract chung MVP v2.1 — Baseline có hiệu lực)  
> **Chế độ:** `PLAN-ONLY` (Tuân thủ nghiêm ngặt: Không viết code `src/*`, không chạy `npm`, không tạo `Dockerfile`, không Git commit).

---

## MỤC LỤC
1. [Phần 1: Tổng quan Kiến trúc & Request Lifecycle](#phần-1-tổng-quan-kiến-trúc--request-lifecycle)
2. [Phần 2: Cấu trúc Thư mục & Trách nhiệm từng File](#phần-2-cấu-trúc-thư-mục--trách-nhiệm-từng-file)
3. [Phần 3: Ma trận Routing & Biến Môi trường](#phần-3-ma-trận-routing--biến-môi-trường)
4. [Phần 4: Chiến lược Xử lý các Edge Cases Kỹ thuật](#phần-4-chiến-lược-xử-lý-các-edge-cases-kỹ-thuật)
5. [Phần 5: Lộ trình Triển khai theo từng Phase (Implementation Phases)](#phần-5-lộ-trình-triển-khai-theo-từng-phase-implementation-phases)
6. [Phần 6: Kế hoạch Kiểm thử (Test Plan)](#phần-6-kế-hoạch-kiểm-thử-test-plan)
7. [Phần 7: Mục CẦN XÁC NHẬN & Rủi ro (RULE-010)](#phần-7-mục-cần-xác-nhận--rủi-ro-rule-010)

---

### PHẦN 1: TỔNG QUAN KIẾN TRÚC & REQUEST LIFECYCLE

API Gateway đóng vai trò là cửa ngõ duy nhất (Single Point of Entry) tiếp nhận toàn bộ lưu lượng HTTP/HTTPS và WebSocket từ Web/Mobile Client (Port `8080`), chịu trách nhiệm kiểm soát bảo mật biên, xác thực danh tính, kiểm tra trạng thái tài khoản thời gian thực (Fail-closed) và định tuyến ngược (Reverse Proxy) tới 6 Upstream Microservices (`8081`–`8086`).

```
[ Client (Web/Mobile) ]
          │ (HTTPS / WSS)
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        FASTIFY API GATEWAY (:8080)                    │
│                                                                        │
│ 1. onRequest Hook:                                                     │
│    ├── Trace ID Injection (X-Request-Id -> req.traceId)                │
│    ├── Pino Logger Binding (Redact 'authorization', 'x-service-key')   │
│    ├── CORS Validation (Allow: PUBLIC_APP_ORIGIN, credentials: false)  │
│    ├── Route Blocker (/internal/** -> 404, plots/:id/summary -> 403)   │
│    └── Header Stripper (Drop x-user-id, x-user-role, x-service-key)    │
│                                                                        │
│ 2. preHandler Hook (Route Guard & Authentication):                     │
│    ├── Route Classification (Public Allowlist vs Protected)            │
│    ├── JWT RS256 Verification (iss, aud, exp, clockSkew 60s, kid pool) │
│    └── Sync Access-State Check (GET /internal/v1/accounts/:id/access) │
│        ├── Hard Timeout 1000ms (undici AbortSignal)                    │
│        ├── ACTIVE & accessAllowed -> Pass                              │
│        ├── LOCKED / INACTIVE / UNVERIFIED -> 403 ACCOUNT_NOT_ACTIVE    │
│        └── Timeout / Unreachable -> 503 ACCESS_STATE_UNAVAILABLE       │
│                                                                        │
│ 3. Reverse Proxy & Streaming:                                          │
│    ├── REST Proxy (@fastify/http-proxy: preserve /api/v1 & Bearer)     │
│    ├── Raw Streaming for Multipart Image Upload (<= 5 MiB)             │
│    └── WebSocket Duplex Proxy -> Chat Service (:8084)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Forward (Internal Network)
        ┌──────────────┬────────────┼────────────┬──────────────┬──────────────┐
        ▼              ▼            ▼            ▼              ▼              ▼
   User Service  Farming Service Trading Serv. Chat Service Payment Serv. Notif. Serv.
     (:8081)        (:8082)       (:8083)      (:8084)        (:8085)       (:8086)
```

#### Thứ tự thực thi chuẩn xác của Fastify Lifecycle Hooks:

1. **`onRequest` — Request ID (`traceId`) & Pino Context:**
   - Trích xuất `X-Request-Id` từ header client (kiểm tra chuẩn UUID). Nếu thiếu hoặc không hợp lệ, khởi tạo UUID mới (`traceId`).
   - Gắn `traceId` vào `request.raw.traceId` và gán vào child logger của Pino.
   - Cấu hình Pino Serializers & Redaction: Bắt buộc cấu hình `redact: ['req.headers.authorization', 'req.headers["x-service-key"]', 'headers.authorization', 'headers["x-service-key"]']` nhằm ngăn chặn rò rỉ secret/token vào log tập trung.
2. **`onRequest` — CORS Policy Enforcement:**
   - Áp dụng cấu hình `@fastify/cors` nghiêm ngặt theo đặc tả §17:
     - `origin`: Chỉ chấp nhận giá trị từ `process.env.PUBLIC_APP_ORIGIN` (mặc định dev: `http://localhost:5173`, cấm wildcard `*`).
     - `credentials`: `false` (Token lưu tại memory của client, không dùng cookie ở MVP).
     - `methods`: `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']`.
     - `allowedHeaders`: `['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id']`.
     - Request `OPTIONS` (Preflight) được Fastify phản hồi ngay `204 No Content` và dừng lifecycle, không bao giờ chạy auth hooks.
3. **`onRequest` — Chặn cứng Route Nội bộ & Route Đặc thù:**
   - **Chặn `/internal/**`:** Nếu URL bắt đầu bằng `/internal/`, lập tức ngắt pipeline và trả về `404 NOT_FOUND` chuẩn contract (nhằm che giấu hoàn toàn sự tồn tại của endpoint nội bộ đối với bên ngoài).
   - **Chặn `GET /api/v1/plots/:plotId/summary`:** Theo đặc tả §15, endpoint này chỉ dành riêng cho Trading Service gọi sang Farming Service bằng internal key. Gateway chặn cứng trước khi route `/api/v1/plots/**` được xử lý, lập tức trả về `403 FORBIDDEN`.
4. **`onRequest` — Strip Header Giả mạo (Header Sanitization):**
   - Loại bỏ triệt để các header giả danh từ client gửi lên:
     - `delete request.headers['x-user-id']`
     - `delete request.headers['x-user-role']`
     - `delete request.headers['x-service-key']`
   - Đảm bảo upstream service không bao giờ nhận được các header tự xưng này từ Internet.
5. **`preHandler` — Phân loại Route (Public vs Protected):**
   - **Public Routes (Allowlist):**
     - `POST /api/v1/auth/register`
     - `POST /api/v1/auth/verify-otp`
     - `POST /api/v1/auth/resend-otp`
     - `POST /api/v1/auth/login`
     - `POST /api/v1/auth/refresh`
     - `GET /health` (Gateway health check)
   - **Protected Routes:** Toàn bộ các route `/api/v1/**` còn lại.
     - *Lưu ý đặc biệt (§4, §17):* `POST /api/v1/auth/logout` **bắt buộc là Protected Route** vì phải kiểm tra token thuộc account đang đăng nhập để thu hồi phiên.
6. **`preHandler` — Xác thực JWT RS256 & Quản lý Multi-kid:**
   - Trích xuất token từ header `Authorization: Bearer <token>`. Nếu thiếu hoặc sai định dạng `Bearer`, ném lỗi `401 UNAUTHORIZED`.
   - Giải mã unverified header của token để lấy claim `kid` (Key ID).
   - Truy vấn `kid` trong tập Public Key Cache. Nếu `kid` không tồn tại, trả ngay `401 UNAUTHORIZED` (Unknown key ID).
   - Verify chữ ký bằng thuật toán `RS256` với Public Key tương ứng.
   - Thẩm định các claims bắt buộc:
     - `iss` phải đúng `urn:soa:user-service`.
     - `aud` phải đúng `soa-api`.
     - `exp`: Thẩm định hạn dùng với dung sai trôi đồng hồ `clockSkew` tối đa `60s` (theo §19).
     - Trích xuất `sub` (accountId dạng UUID), `role` (`FARMER` | `TRADER` | `ADMIN`).
7. **`preHandler` — Gọi đồng bộ kiểm tra `access-state` (Edge Enforcement):**
   - Theo đặc tả §4, Gateway gọi trực tiếp: `GET /internal/v1/accounts/{accountId}/access-state` tới User Service (`8081`).
   - Header gửi kèm: `X-Service-Key: <GATEWAY_TO_USER_SERVICE_KEY>` và `X-Request-Id: <traceId>`.
   - **Không cache trạng thái `ACTIVE`** (đảm bảo tính tức thời khi tài khoản bị khóa do Admin hoặc điểm uy tín về 0).
   - **Timeout cứng 1000ms** thông qua `undici` + `AbortSignal.timeout(1000)`.
   - **Cơ chế Fail-Closed:**
     - Nếu User Service timeout (> 1000ms) hoặc không thể kết nối hoặc trả lỗi 5xx: Ném lỗi `503 ACCESS_STATE_UNAVAILABLE`.
     - Nếu User Service phản hồi 200, kiểm tra payload `{ status, accessAllowed }`:
       - Nếu `status !== 'ACTIVE'` hoặc `accessAllowed !== true` (bao gồm `LOCKED`, `INACTIVE`, `UNVERIFIED`): Ném lỗi `403 ACCOUNT_NOT_ACTIVE`.
       - Nếu hợp lệ: Cho phép request đi tiếp sang tầng Proxy.
8. **Proxy Execution — Reverse Proxy & Streaming:**
   - Chuyển tiếp request nguyên vẹn sang upstream tương ứng bằng `@fastify/http-proxy`.
   - Giữ nguyên prefix `/api/v1` (theo §15).
   - Giữ nguyên header `Authorization: Bearer <token>` để upstream service tự xác thực lại danh tính và kiểm tra ownership tài nguyên.
   - Giữ nguyên stream multipart cho các upload ảnh (≤ 5 MiB), tuyệt đối không parse body tại Gateway.
   - Xử lý HTTP Upgrade cho kênh WebSocket kết nối Chat Service.

---

### PHẦN 2: CẤU TRÚC THƯ MỤC & TRÁCH NHIỆM TỪNG FILE

Đề xuất cấu trúc thư mục chuẩn cho repo `api-gateway` (Fastify thuần + TypeScript, không dùng lồng framework khác):

```
api-gateway/
├── docs/
│   ├── BA - SOA.md
│   └── api-gateway-implementation-plan.md
├── src/
│   ├── config/
│   │   ├── env.ts                   # Schema Zod validate toàn bộ biến môi trường khi bootstrap
│   │   └── public-keys.ts           # Loader & Cache quản lý tập Public Key RS256 theo 'kid'
│   ├── constants/
│   │   ├── error-codes.ts           # Định nghĩa enum chuẩn các mã lỗi theo BA §3, §10
│   │   └── routes.ts                # Danh sách Public Allowlist, Blocked Routes, Special Routes
│   ├── errors/
│   │   ├── app-error.ts             # Lớp AppError chuẩn hóa (status, code, message)
│   │   └── error-handler.ts         # Fastify setErrorHandler & setNotFoundHandler format chuẩn
│   ├── hooks/
│   │   ├── request-id.ts            # Hook onRequest: Xử lý traceId và Pino child logger
│   │   ├── strip-headers.ts         # Hook onRequest: Strip sạch x-user-id, x-user-role, x-service-key
│   │   ├── route-guard.ts           # Hook onRequest: Chặn /internal/** và GET plots/:id/summary
│   │   └── auth-guard.ts            # Hook preHandler: Phân loại route, verify JWT, gọi access-state
│   ├── plugins/
│   │   ├── cors.ts                  # Plugin đăng ký @fastify/cors cấu hình chuẩn BA §17
│   │   ├── reverse-proxy.ts         # Plugin cấu hình @fastify/http-proxy cho 6 upstream services
│   │   └── websocket.ts             # Plugin xử lý nâng cấp giao thức WebSocket cho Chat Service
│   ├── services/
│   │   └── access-state.client.ts   # Client HTTP (Undici) gọi User Service kèm timeout cứng 1000ms
│   ├── app.ts                       # Hàm buildApp(): Lắp ráp toàn bộ plugins, hooks, error handlers
│   └── server.ts                    # Entrypoint: Khởi động HTTP server trên port 8080, graceful shutdown
├── test/
│   ├── helpers/
│   │   ├── mock-user-service.ts     # Mock server giả lập User Service (access-state response/timeout)
│   │   ├── mock-upstreams.ts        # Mock server giả lập các upstream 8082-8086
│   │   └── token-helper.ts          # Helper tạo cặp key RSA, sign JWT test với các kid khác nhau
│   ├── unit/
│   │   ├── env.test.ts              # Unit test validate cấu hình Zod
│   │   └── public-keys.test.ts      # Unit test cơ chế parse và tìm kiếm key theo kid
│   └── integration/
│       ├── gateway-security.test.ts # Test chặn /internal, plots summary, strip header
│       ├── jwt-verification.test.ts # Test RS256, iss, aud, exp, clockSkew, kid rotation
│       ├── access-state.test.ts     # Test ACTIVE, LOCKED, timeout 1000ms -> 503 fail-closed
│       ├── proxy-routing.test.ts    # Test routing, giữ nguyên prefix /api/v1, giữ Bearer
│       └── error-contract.test.ts   # Test 100% lỗi trả về đúng cấu trúc, không lộ stack trace
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

#### Trách nhiệm chính của các module:
- `config/`: Đảm bảo fail-fast ngay khi khởi động nếu thiếu biến môi trường hoặc public key bị lỗi cú pháp.
- `errors/`: Tập trung hóa 100% việc chuẩn hóa lỗi, đảm bảo tính nhất quán tuyệt đối của Error Contract trên toàn hệ thống.
- `hooks/`: Thực hiện nhiệm vụ bảo mật biên theo từng giai đoạn của Fastify Lifecycle.
- `plugins/`: Đóng gói tính năng reverse proxy, CORS và WebSocket proxy thành các module độc lập, dễ kiểm thử.
- `services/`: Quản lý kết nối ra ngoài với pool connection tối ưu và xử lý timeout chặt chẽ.

---

### PHẦN 3: MA TRẬN ROUTING & BIẾN MÔI TRƯỜNG

#### 1. Bảng ánh xạ ma trận Routing từ Public Path -> Upstream Services:

| STT | Public Path / Pattern | Upstream Service | Port | Phương thức | Ghi chú & Ràng buộc bảo mật |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `/api/v1/auth/**` | User Service | `8081` | REST | Public (trừ `POST /logout` là Protected) |
| 2 | `/api/v1/users/**` | User Service | `8081` | REST | Protected (Bao gồm upload avatar me/avatar) |
| 3 | `/api/v1/farmers/**` | User Service | `8081` | REST | Protected |
| 4 | `/api/v1/traders/**` | User Service | `8081` | REST | Protected |
| 5 | `/api/v1/admin/accounts/**` | User Service | `8081` | REST | Protected (Chỉ ADMIN ACTIVE) |
| 6 | `/api/v1/plots/:plotId/summary` | Farming Service | `8082` | REST | **BỊ CHẶN CỨNG TẠI GATEWAY (Trả 403)** |
| 7 | `/api/v1/plots/**` | Farming Service | `8082` | REST | Protected (Sau khi đã loại trừ route summary) |
| 8 | `/api/v1/crop-seasons/**` | Farming Service | `8082` | REST | Protected |
| 9 | `/api/v1/logs/**` | Farming Service | `8082` | REST | Protected |
| 10 | `/api/v1/costs/**` | Farming Service | `8082` | REST | Protected |
| 11 | `/api/v1/listings/**` | Trading Service | `8083` | REST | Protected |
| 12 | `/api/v1/offers/**` | Trading Service | `8083` | REST | Protected |
| 13 | `/api/v1/conversations/**` | Chat Service | `8084` | REST | Protected (Bao gồm upload ảnh chat) |
| 14 | WebSocket Route (`/ws/chat`) | Chat Service | `8084` | WebSocket | Nâng cấp kết nối HTTP -> WS Duplex |
| 15 | `/api/v1/payments/**` | Payment Service | `8085` | REST | Protected (Contract, Deposit, Dispute, Admin) |
| 16 | `/api/v1/notifications/**`| Notification Service| `8086` | REST | Protected (REST Own Account) |
| 17 | `/internal/**` | *Không có* | - | - | **CHẶN HOÀN TOÀN TẠI BIÊN (Trả 404)** |

#### 2. Danh sách biến môi trường trong `.env.example` & Schema Zod:

```typescript
// Định nghĩa kiểu dữ liệu và schema validate bằng Zod
import { z } from 'zod';

export const EnvSchema = z.object({
  // Server Config
  SERVER_PORT: z.coerce.number().default(8080),
  SERVER_HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // CORS Config (§17)
  PUBLIC_APP_ORIGIN: z.string().url().default('http://localhost:5173'),

  // JWT Security Config (§4, §19)
  JWT_ISSUER: z.string().default('urn:soa:user-service'),
  JWT_AUDIENCE: z.string().default('soa-api'),
  JWT_CLOCK_SKEW_SECONDS: z.coerce.number().default(60),
  // Chuỗi JSON map { [kid: string]: string (PEM) } để nạp nhiều public key xoay vòng
  JWT_PUBLIC_KEYS_JSON: z.string().min(10),

  // Upstream Services Base URLs (§15, §19)
  USER_SERVICE_URL: z.string().url().default('http://localhost:8081'),
  FARMING_SERVICE_URL: z.string().url().default('http://localhost:8082'),
  TRADING_SERVICE_URL: z.string().url().default('http://localhost:8083'),
  CHAT_SERVICE_URL: z.string().url().default('http://localhost:8084'),
  CHAT_SERVICE_WS_URL: z.string().default('ws://localhost:8084'),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:8085'),
  NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:8086'),

  // Inter-Service Security Key (§4, §19)
  GATEWAY_TO_USER_SERVICE_KEY: z.string().min(16),
  ACCESS_STATE_TIMEOUT_MS: z.coerce.number().default(1000),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
```

---

### PHẦN 4: CHIẾN LƯỢC XỬ LÝ CÁC EDGE CASES KỸ THUẬT

#### 1. Đảm bảo streaming nguyên vẹn cho multipart upload ảnh (≤ 5 MiB) mà không bị Fastify nuốt body:
- **Nguyên nhân gốc rễ:** Nếu Gateway đăng ký các plugin parse body dạng multipart (như `@fastify/multipart`) trên toàn cục, Fastify sẽ đọc hết stream dữ liệu từ socket trước khi chuyển qua handler. Khi proxy chuyển tiếp, request stream đã bị rỗng (consumed) hoặc payload bị hỏng.
- **Giải pháp kiến trúc:**
  - Tuyệt đối **không** đăng ký multipart body parser trên các route proxy tại Gateway.
  - Sử dụng `@fastify/http-proxy` kết hợp với `undici` để đường truyền socket từ client được pipe trực tiếp dạng raw stream (Node.js Readable stream) sang upstream socket của User/Chat/Payment Service.
  - **Kiểm soát kích thước tại biên:**
    - Nếu request có header `Content-Length`: Kiểm tra ngay lập tức. Nếu `Content-Length > 5,242,880` bytes (5 MiB), ngắt kết nối và phản hồi ngay `413 PAYLOAD_TOO_LARGE` mà không cần nhận stream.
    - Nếu request dạng `Transfer-Encoding: chunked`: Pipe stream qua một module kiểm đếm byte (PassThrough transform stream). Nếu lượng byte vượt quá 5 MiB, lập tức hủy stream (`stream.destroy()`) và trả về `413 PAYLOAD_TOO_LARGE`.
  - Việc thẩm định ma thuật byte ảnh thực tế (JPEG/PNG/WebP, 20 megapixel) được ủy quyền cho Service Owner chịu trách nhiệm lưu trữ theo đúng BA §18.

#### 2. Proxy WebSocket cho Chat Service (`8084`) mà không truyền token qua query string:
- **Ràng buộc đặc tả:** Theo §17, cấm tuyệt đối việc truyền JWT qua URL query (`ws://domain/ws?token=...`) vì query string sẽ bị lưu vào access log của proxy/server, vi phạm an toàn thông tin.
- **Giải pháp kiến trúc:**
  - Gateway lắng nghe sự kiện HTTP `upgrade` trên đường dẫn WebSocket chuyên dụng (ví dụ: `/ws/chat`).
  - Khi bắt được sự kiện `upgrade`, Gateway thiết lập kênh duplex stream raw trực tiếp tới Chat Service (`ws://chat-service:8084`) mà **không can thiệp xác thực JWT trong HTTP handshake ban đầu**.
  - Quy trình xác thực thời gian thực tuân thủ nghiêm ngặt BA §17: Client thiết lập kết nối WebSocket thô thành công, sau đó gửi frame bản tin đầu tiên là bản tin `CONNECT` chứa JWT trong payload lên Chat Service. Chat Service sẽ tự thẩm định JWT và kiểm tra access-state trước khi cho phép `SUBSCRIBE` hoặc `SEND`. Nếu token hết hạn, client reconnect và xác thực lại.

#### 3. Chuẩn hóa 100% lỗi tại Gateway về đúng Error Contract:
- **Ràng buộc đặc tả:** BA §3 quy định định dạng lỗi duy nhất:
  ```json
  {
    "timestamp": "2026-11-22T13:30:00.000Z",
    "status": 401,
    "code": "UNAUTHORIZED",
    "message": "Chi tiết lỗi",
    "path": "/api/v1/...",
    "traceId": "uuid-trace-id"
  }
  ```
  Tuyệt đối không lộ stack trace, câu lệnh SQL, hoặc đường dẫn file hệ thống.
- **Giải pháp kiến trúc:**
  - Triển khai `fastify.setErrorHandler((error, request, reply) => { ... })`:
    - Nếu lỗi là thể hiện của `AppError`, trích xuất `status`, `code`, `message`.
    - Nếu là lỗi validation tích hợp của Fastify (ví dụ `FST_ERR_VALIDATION`), chuẩn hóa về HTTP `400` với `code: "VALIDATION_ERROR"`.
    - Nếu là lỗi payload vượt ngưỡng, chuẩn hóa về HTTP `413` với `code: "PAYLOAD_TOO_LARGE"`.
    - Nếu là lỗi không xác định (Internal Server Error): Ghi log chi tiết lỗi kèm stack trace vào Pino (`request.log.error(error)`), nhưng tại payload trả về client thì ẩn hoàn toàn chi tiết kỹ thuật: `status: 500`, `code: "INTERNAL_SERVER_ERROR"`, `message: "Internal server error"`.
  - Triển khai `fastify.setNotFoundHandler((request, reply) => { ... })`: Chuẩn hóa các route không tồn tại về HTTP `404` với `code: "NOT_FOUND"`.

#### 4. Xử lý timeout đúng 1000ms khi gọi User Service `access-state` bằng `undici` / `AbortSignal.timeout`:
- **Ràng buộc đặc tả:** BA §4 & §19: Timeout tổng cho việc kiểm tra access-state là đúng `1000ms`. Nếu quá thời gian hoặc User Service down, bắt buộc Fail-closed trả về `503 ACCESS_STATE_UNAVAILABLE`.
- **Giải pháp kiến trúc:**
  - Sử dụng HTTP Client tối ưu hóa `undici.request` của Node.js runtime.
  - Sử dụng API chuẩn `AbortSignal.timeout(1000)`.
  - Cấu hình connection pool của Undici dành riêng cho endpoint User Service:
    - `connectTimeout: 500ms` (thời gian bắt tay TCP nội bộ).
    - `headersTimeout: 1000ms`.
    - `bodyTimeout: 1000ms`.
  - Bắt ngoại lệ:
    - Nếu lỗi có tên `TimeoutError` hoặc `AbortError`: Log cảnh báo timeout, ném `AppError(503, "ACCESS_STATE_UNAVAILABLE", "User service access-state check timed out after 1000ms")`.
    - Nếu lỗi kết nối mạng (ECONNREFUSED, socket hang up): Ném `AppError(503, "ACCESS_STATE_UNAVAILABLE", "User service access-state check is unreachable")`.

#### 5. Nạp và xoay vòng tập Public Key (`kid`) không cần JWKS API:
- **Ràng buộc đặc tả:** BA §19: Key xoay vòng có thời gian overlap tối thiểu 16 phút (15 phút hạn access token + 60s clock skew). Cấu hình nạp qua deployment, không tự ý xây dựng API JWKS bên ngoài.
- **Giải pháp kiến trúc:**
  - Xây dựng lớp `PublicKeyStore` dạng in-memory map `Map<string, string>` ánh xạ từ `kid` sang chuỗi PEM Public Key.
  - Nguồn nạp: Đọc từ biến môi trường `JWT_PUBLIC_KEYS_JSON` (hoặc mount thư mục chứa các file `<kid>.pem`).
    Ví dụ định dạng cấu hình:
    ```json
    {
      "key-2026-v1": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...",
      "key-2026-v2": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq..."
    }
    ```
  - Khi request đến:
    - Dùng `jwt.decode(token, { complete: true })` để đọc header của token.
    - Lấy ra trường `header.kid`.
    - Tìm public key tương ứng trong `PublicKeyStore`. Nếu không tìm thấy, từ chối với lỗi `401 UNAUTHORIZED`.
    - Tiến hành verify chữ ký với đúng public key đó.
  - Trong chu kỳ xoay key (Key Rotation): DevOps chỉ cần cập nhật biến môi trường chứa đồng thời cả `key cũ` và `key mới`. Gateway nhận diện cả hai key mà không cần restart gián đoạn và không cần gọi ra Internet/JWKS endpoint.

---

### PHẦN 5: LỘ TRÌNH TRIỂN KHAI THEO TỪNG PHASE (IMPLEMENTATION PHASES)

#### Phase 1: Khởi tạo Project & Cấu hình Nền tảng (Foundation & Base Config)
- **Mục tiêu:** Thiết lập cấu trúc dự án Fastify + TypeScript, cài đặt các quy chuẩn linting/typing, nạp và validate biến môi trường với Zod, cấu hình hệ thống logging Pino và xử lý Request ID.
- **Danh sách file dự kiến tạo/sửa:**
  - `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
  - `src/config/env.ts`
  - `src/constants/error-codes.ts`
  - `src/constants/routes.ts`
  - `src/errors/app-error.ts`
  - `src/errors/error-handler.ts`
  - `src/hooks/request-id.ts`
  - `src/app.ts`, `src/server.ts`
- **Tiêu chí hoàn thành (DoD):**
  - Server biên dịch không có lỗi TypeScript, khởi động thành công trên port `8080`.
  - Validate biến môi trường bằng Zod hoạt động chính xác (ném lỗi và thoát nếu env không hợp lệ).
  - Mọi request gửi vào đều sinh ra `traceId` chuẩn UUID; logger tự động ẩn các trường nhạy cảm (`authorization`, `x-service-key`).
  - Gửi request đến route không tồn tại trả về đúng định dạng Error Contract `{timestamp, status: 404, code: 'NOT_FOUND', ...}`.

#### Phase 2: Bảo mật Biên, CORS & Xác thực JWT RS256 (Edge Security & JWT)
- **Mục tiêu:** Hoàn thiện lớp bảo mật biên: cấu hình CORS nghiêm ngặt, chặn cứng route nội bộ, strip các header giả mạo từ client và xác thực JWT RS256 hỗ trợ multi-kid.
- **Danh sách file dự kiến tạo/sửa:**
  - `src/config/public-keys.ts`
  - `src/plugins/cors.ts`
  - `src/hooks/strip-headers.ts`
  - `src/hooks/route-guard.ts`
  - `src/hooks/jwt-verify.ts`
  - `test/unit/public-keys.test.ts`
  - `test/integration/gateway-security.test.ts`
- **Tiêu chí hoàn thành (DoD):**
  - Client gửi header `x-user-id`, `x-user-role`, `x-service-key` bị xóa hoàn toàn trước khi xử lý tiếp.
  - Request tới `/internal/**` bị trả về `404 NOT_FOUND`.
  - Request tới `GET /api/v1/plots/:plotId/summary` bị chặn cứng và trả về `403 FORBIDDEN`.
  - CORS chỉ cho phép origin từ `PUBLIC_APP_ORIGIN`, trả về header preflight chuẩn cho `OPTIONS`.
  - Verify thành công JWT RS256 với các `kid` khác nhau, đúng `iss`, `aud`, và trôi đồng hồ ≤ `60s`. Token sai hoặc hết hạn bị từ chối với `401 UNAUTHORIZED`.

#### Phase 3: Kiểm tra Trạng thái Tài khoản Tức thời (Access-State Enforcement)
- **Mục tiêu:** Tích hợp kiểm tra trạng thái tài khoản thời gian thực với User Service qua `GET /internal/v1/accounts/{accountId}/access-state`, đảm bảo cơ chế fail-closed và timeout 1000ms.
- **Danh sách file dự kiến tạo/sửa:**
  - `src/services/access-state.client.ts`
  - `src/hooks/auth-guard.ts` (kết hợp JWT verify + access-state)
  - `test/helpers/mock-user-service.ts`
  - `test/integration/access-state.test.ts`
- **Tiêu chí hoàn thành (DoD):**
  - Route public đi qua bình thường mà không cần kiểm tra token hoặc access-state.
  - `POST /api/v1/auth/logout` bắt buộc đi qua kiểm tra token hợp lệ.
  - Tài khoản có trạng thái `ACTIVE` và `accessAllowed: true` được cho phép tiếp tục.
  - Tài khoản có trạng thái `LOCKED`, `INACTIVE`, hoặc `UNVERIFIED` bị từ chối với `403 ACCOUNT_NOT_ACTIVE`.
  - Khi User Service bị chậm (> 1000ms) hoặc sập, Gateway phản hồi ngay lập tức `503 ACCESS_STATE_UNAVAILABLE`.

#### Phase 4: Định tuyến Reverse Proxy, Streaming & WebSocket (Routing & Proxying)
- **Mục tiêu:** Cấu hình ma trận proxy chuyển tiếp toàn bộ 6 microservices, giữ nguyên prefix `/api/v1`, giữ nguyên `Authorization: Bearer`, hỗ trợ streaming multipart upload và proxy WebSocket.
- **Danh sách file dự kiến tạo/sửa:**
  - `src/plugins/reverse-proxy.ts`
  - `src/plugins/websocket.ts`
  - `test/helpers/mock-upstreams.ts`
  - `test/integration/proxy-routing.test.ts`
- **Tiêu chí hoàn thành (DoD):**
  - Toàn bộ các path trong ma trận routing chuyển tiếp chính xác đến port tương ứng (`8081`–`8086`).
  - Header `Authorization` và `X-Request-Id` được chuyển tiếp đầy đủ xuống upstream.
  - Upload file ảnh (≤ 5 MiB) truyền tải nguyên vẹn dạng stream, không bị đọc buffer tại Gateway; file > 5 MiB bị từ chối với `413 PAYLOAD_TOO_LARGE`.
  - Nâng cấp kết nối WebSocket cho Chat Service hoạt động thông suốt mà không cần query token trên URL.

#### Phase 5: Suite Kiểm thử Tích hợp Toàn diện (Acceptance Test Suite)
- **Mục tiêu:** Xây dựng toàn bộ các integration test case sử dụng `fastify.inject()`, ánh xạ 1-1 với Acceptance Tests tại Mục 16 của `BA - SOA.md`.
- **Danh sách file dự kiến tạo/sửa:**
  - `test/helpers/token-helper.ts`
  - `test/integration/acceptance-criteria.test.ts`
  - `vitest.config.ts`
- **Tiêu chí hoàn thành (DoD):**
  - 100% các kịch bản kiểm thử biên và kiểm thử bảo mật chạy pass.
  - Bao phủ toàn bộ các case lỗi: 400, 401, 403, 404, 413, 429, 503, 500.

#### Phase 6: Đóng gói Docker & Vận hành (Dockerization & Production Readiness)
- **Mục tiêu:** Tạo Dockerfile tối ưu (Multi-stage build), cấu hình `.dockerignore`, sẵn sàng tích hợp vào docker-compose chung của hệ thống.
- **Danh sách file dự kiến tạo/sửa:**
  - `Dockerfile`
  - `.dockerignore`
- **Tiêu chí hoàn thành (DoD):**
  - Docker container build thành công, chạy dưới quyền non-root user (node).
  - Container giao tiếp thông suốt với các service khác thông qua Docker network DNS (`http://user-service:8081`,...).

---

### PHẦN 6: KẾ HOẠCH KIỂM THỬ (TEST PLAN)

Toàn bộ test suite được viết bằng `fastify.inject()` nhằm kiểm thử trực tiếp ứng dụng Fastify mà không cần mở port mạng thực tế, kết hợp mock upstream server bằng `undici.MockAgent` hoặc `http.createServer`:

| Mã Test Case | Tên kịch bản kiểm thử | Mô tả & Input | Kết quả kỳ vọng (Expected Output) | Ánh xạ BA - SOA §16 |
|:---|:---|:---|:---|:---|
| `TC-SEC-01` | Chặn route nội bộ `/internal` | Gửi `GET /internal/v1/accounts/123/access-state` | `404 NOT_FOUND` | Mục 4 & 15 |
| `TC-SEC-02` | Chặn route đặc biệt tóm tắt Plot | Gửi `GET /api/v1/plots/UUID-1/summary` | `403 FORBIDDEN` (code: `FORBIDDEN`) | Mục 15 |
| `TC-SEC-03` | Xóa header giả mạo từ Client | Gửi kèm header `x-user-id`, `x-user-role`, `x-service-key` | Upstream nhận request **không** có các header này | Mục 2 & 4 |
| `TC-CORS-01` | Preflight CORS hợp lệ | Gửi `OPTIONS /api/v1/listings` với `Origin: http://localhost:5173` | `204 No Content`, có đủ CORS headers | Mục 17 |
| `TC-CORS-02` | Preflight CORS không hợp lệ | Gửi `OPTIONS /api/v1/listings` với `Origin: http://evil-site.com` | Không trả về CORS allow origin header | Mục 17 |
| `TC-AUTH-01` | Public route không cần JWT | Gửi `POST /api/v1/auth/login` không có header `Authorization` | Proxy chuyển tiếp thành công xuống User Service | Mục 4 & 15 |
| `TC-AUTH-02` | Logout bắt buộc có JWT | Gửi `POST /api/v1/auth/logout` không có `Authorization` | `401 UNAUTHORIZED` | Mục 4 & 17 |
| `TC-AUTH-03` | Protected route thiếu token | Gửi `GET /api/v1/plots` không có `Authorization` | `401 UNAUTHORIZED` | Mục 16.1 |
| `TC-AUTH-04` | Token hết hạn (vượt clock skew) | Gửi token có `exp` đã qua 120s | `401 UNAUTHORIZED` | Mục 16.1 |
| `TC-AUTH-05` | Dung sai trôi đồng hồ (Clock Skew) | Gửi token có `exp` vừa hết hạn 30s (< 60s) | Cho phép xác thực, tiếp tục gọi access-state | Mục 19 |
| `TC-AUTH-06` | Sai Issuer hoặc Audience | Gửi token có `iss=wrong` hoặc `aud=wrong` | `401 UNAUTHORIZED` | Mục 16.1 |
| `TC-AUTH-07` | Xoay vòng khóa (Multi-kid) | Gửi token ký bởi `key-v1` và token ký bởi `key-v2` | Cả 2 đều verify thành công | Mục 19 |
| `TC-AUTH-08` | Key ID (`kid`) không tồn tại | Gửi token có `kid=unknown-key` trong header | `401 UNAUTHORIZED` | Mục 19 |
| `TC-STATE-01`| Tài khoản ACTIVE hợp lệ | Mock User Service trả `status: ACTIVE, accessAllowed: true` | Proxy chuyển tiếp thành công xuống upstream | Mục 4 |
| `TC-STATE-02`| Tài khoản bị khóa (LOCKED) | Mock User Service trả `status: LOCKED, accessAllowed: false` | `403 ACCOUNT_NOT_ACTIVE` | Mục 16.2 |
| `TC-STATE-03`| Tài khoản chưa verify (UNVERIFIED)| Mock User Service trả `status: UNVERIFIED` | `403 ACCOUNT_NOT_ACTIVE` | Mục 16.1 |
| `TC-STATE-04`| User Service bị timeout (>1000ms)| Giả lập User Service delay 1200ms | `503 ACCESS_STATE_UNAVAILABLE` | Mục 16.1 |
| `TC-STATE-05`| User Service bị sập / lỗi mạng | Giả lập connection refused đến port 8081 | `503 ACCESS_STATE_UNAVAILABLE` | Mục 16.1 |
| `TC-PROXY-01`| Giữ nguyên prefix `/api/v1` | Gửi request `GET /api/v1/listings` | Upstream nhận đúng path `/api/v1/listings` | Mục 15 |
| `TC-PROXY-02`| Giữ nguyên Bearer token | Gửi request có `Authorization: Bearer <token>` | Upstream nhận nguyên vẹn header `Authorization` | Mục 4 |
| `TC-MEDIA-01`| Upload ảnh vượt quá 5 MiB | Gửi `POST /api/v1/users/me/avatar` có Content-Length > 5 MiB | `413 PAYLOAD_TOO_LARGE` | Mục 3 & 18 |
| `TC-ERR-01`  | Chuẩn hóa định dạng Error Contract | Kiểm tra cấu trúc JSON của mọi response lỗi | Đầy đủ 6 trường: `timestamp, status, code, message, path, traceId` | Mục 3 & 10 |

---

### PHẦN 7: MỤC CẦN XÁC NHẬN & RỦI RO (RULE-010)

Tuân thủ nghiêm ngặt quy tắc `RULE-010`, dưới đây là các điểm kỹ thuật cần chủ dự án / team backend xác nhận trước khi bắt tay vào triển khai mã nguồn:

1. **Đường dẫn URL chính xác của WebSocket Chat Service:**
   - *Hiện trạng đặc tả:* Tại §15 chỉ ghi: `"/api/v1/conversations/ và WebSocket Chat hiện có • Destination: Chat8084"`.
   - *Điểm cần xác nhận:* Đường dẫn chính xác mà Frontend sẽ mở kết nối WebSocket tới Gateway là gì? (Ví dụ: `ws://localhost:8080/ws/chat` hay `ws://localhost:8080/api/v1/chat/ws`?). Chat Service sử dụng giao thức WebSocket thuần (`ws`) hay Socket.io?
2. **Định dạng cấu hình nạp tập Public Key (`kid`):**
   - *Hiện trạng đặc tả:* Tại §19 quy định xoay key overlap 16 phút, nạp qua deployment, không dùng JWKS API.
   - *Điểm cần xác nhận:* Đội vận hành muốn nạp tập key này qua biến môi trường dạng JSON String (ví dụ `JWT_PUBLIC_KEYS_JSON='{"kid1":"PEM...","kid2":"PEM..."}'`) hay mount một thư mục volume chứa các file `.pem` (ví dụ `/etc/jwt-keys/*.pem`)?
3. **Mã lỗi khi Gateway chặn cứng `/internal/**`:**
   - *Hiện trạng đặc tả:* Yêu cầu không public internal endpoint.
   - *Điểm cần xác nhận:* Gateway nên trả về `404 NOT_FOUND` (để bảo mật tối đa, khiến kẻ tấn công không biết route có tồn tại hay không) hay trả về `403 FORBIDDEN`? (*Đề xuất kiến trúc: Trả về `404 NOT_FOUND`*).
4. **Tên biến môi trường bí mật cho Service Key (Gateway -> User Service):**
   - *Hiện trạng đặc tả:* Yêu cầu dùng `X-Service-Key` riêng giữa từng cặp caller-callee, không dùng key chung toàn hệ thống (§19).
   - *Điểm cần xác nhận:* Chốt tên biến môi trường này là `GATEWAY_TO_USER_SERVICE_KEY`.
5. **Rủi ro hiệu năng (Latency & Throughput) của Edge Check đồng bộ:**
   - *Cảnh báo kỹ thuật:* Do Gateway bắt buộc gọi đồng bộ `access-state` tới User Service trên **tất cả** các request được bảo vệ mà **không được cache** trạng thái `ACTIVE` (§4), mỗi request từ client sẽ tốn thêm 1 round-trip HTTP nội bộ (tăng 2–10ms latency). User Service DB primary sẽ phải chịu tải đọc tỷ lệ thuận 1:1 với toàn bộ request của hệ thống. Team User Service cần đảm bảo database indexing cột `account_id` và kích thước connection pool sẵn sàng cho mức tải này.
