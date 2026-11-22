# Báo Cáo Triển Khai Phase 4: Reverse Proxy Routing Matrix, Streaming Upload & WebSocket Proxy

## 1. Thông Tin Tổng Quan
- **Service:** `api-gateway` (Port `8080`)
- **Phase:** 4 — Reverse Proxy, Streaming & WebSocket Proxy
- **Branch:** `feat/phase-4-reverse-proxy`
- **Tài liệu căn cứ:** `docs/BA - SOA.md` (MVP Contract v2.1 baseline: §4 Security, §15 Gateway Port Matrix, §16 Acceptance Tests, §18 Upload/Media)
- **Kế hoạch đối chiếu:** `docs/api-gateway-implementation-plan.md` (Phase 4)

---

## 2. Mục Tiêu Của Phase 4
1. Cấu hình bảng định tuyến ngược (Reverse Proxy) thông qua `@fastify/http-proxy` đến 6 microservices nội bộ:
   - **User Service** (Port `8081`): `/api/v1/auth`, `/api/v1/users`, `/api/v1/farmers`, `/api/v1/traders`, `/api/v1/admin/accounts`
   - **Farming Service** (Port `8082`): `/api/v1/plots`, `/api/v1/crop-seasons`, `/api/v1/logs`, `/api/v1/costs`
   - **Trading Service** (Port `8083`): `/api/v1/listings`, `/api/v1/offers`
   - **Chat Service** (Port `8084`): `/api/v1/conversations`, `/ws/chat` (WebSocket)
   - **Payment Service** (Port `8085`): `/api/v1/payments`
   - **Notification Service** (Port `8086`): `/api/v1/notifications`
2. Đảm bảo bảo toàn toàn vẹn tiền tố đường dẫn `/api/v1/...` khi chuyển tiếp sang upstream (`rewritePrefix: route.prefix`).
3. Đảm bảo chuyển tiếp đầy đủ header `Authorization: Bearer <token>` và `X-Request-Id: <traceId>`.
4. Không parse multipart body tại Gateway đối với các route upload media (`POST /api/v1/listings/upload-images`), thực hiện raw streaming truyền thẳng xuống upstream; chặn sớm các request có `Content-Length > 5 MiB` với mã lỗi `413 PAYLOAD_TOO_LARGE` (§18).
5. Xử lý bắt lỗi khi upstream microservice bị sập/ngắt kết nối (ECONNREFUSED / FST_REPLY_FROM_INTERNAL_SERVER_ERROR), chuẩn hóa về đúng Error Contract `503 DEPENDENCY_UNAVAILABLE` mà không làm rò rỉ topology mạng nội bộ.

---

## 3. Kiến Trúc & Các Thư Viện Sử Dụng

### 3.1. Thư Viện & Công Nghệ
- **`@fastify/http-proxy` (v11.x)**: Plugin reverse proxy chính thức của Fastify, tích hợp sẵn streaming pipeline hiệu năng cao dựa trên `@fastify/reply-from`, hỗ trợ WebSocket proxy natively.
- **`Fastify` Hooks Pipeline**:
  - `onRequest`: `requestIdHook` (sinh & gán `traceId` vào `request.headers['x-request-id']` và reply header), `corsPlugin`, `routeGuardHook`, `stripHeadersHook`.
  - `preHandler`: `payloadLimitHook` (kiểm tra `Content-Length > 5 MiB`), `jwtVerifyHook` (xác thực RS256 token), `accessStateHook` (truy vấn trạng thái tài khoản thời gian thực qua User Service).
- **`Node.js http` & `vitest`**: Xây dựng mock upstream servers đa cổng để kiểm thử tích hợp toàn bộ ma trận định tuyến.

### 3.2. Chi Tiết Triển Khai Kỹ Thuật

#### a. Ma Trận Định Tuyến Reverse Proxy (`src/plugins/reverse-proxy.ts`)
```typescript
export function getProxyRoutes(env: EnvConfig): RouteProxyConfig[] {
  return [
    // 1. User Service (Port 8081)
    { prefix: '/api/v1/auth', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/users', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/farmers', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/traders', upstream: env.USER_SERVICE_URL },
    { prefix: '/api/v1/admin/accounts', upstream: env.USER_SERVICE_URL },

    // 2. Farming Service (Port 8082)
    { prefix: '/api/v1/plots', upstream: env.FARMING_SERVICE_URL },
    { prefix: '/api/v1/crop-seasons', upstream: env.FARMING_SERVICE_URL },
    { prefix: '/api/v1/logs', upstream: env.FARMING_SERVICE_URL },
    { prefix: '/api/v1/costs', upstream: env.FARMING_SERVICE_URL },

    // 3. Trading Service (Port 8083)
    { prefix: '/api/v1/listings', upstream: env.TRADING_SERVICE_URL },
    { prefix: '/api/v1/offers', upstream: env.TRADING_SERVICE_URL },

    // 4. Chat Service (Port 8084) - REST & WebSocket
    { prefix: '/api/v1/conversations', upstream: env.CHAT_SERVICE_URL },
    { prefix: '/ws/chat', upstream: env.CHAT_SERVICE_WS_URL, ws: true },

    // 5. Payment Service (Port 8085)
    { prefix: '/api/v1/payments', upstream: env.PAYMENT_SERVICE_URL },

    // 6. Notification Service (Port 8086)
    { prefix: '/api/v1/notifications', upstream: env.NOTIFICATION_SERVICE_URL },
  ];
}
```
Thiết lập `rewritePrefix: route.prefix` để đảm bảo upstream nhận đúng URL gốc kèm query string (`/api/v1/listings?page=0&size=20`).

#### b. Giới Hạn Kích Thước Upload & Raw Streaming (`src/hooks/payload-limit.ts`)
- Kiểm tra header `content-length`: nếu vượt quá `MAX_MEDIA_PAYLOAD_BYTES = 5 * 1024 * 1024` (5 MiB), từ chối ngay lập tức tại Gateway với mã lỗi `413 PAYLOAD_TOO_LARGE`.
- Gateway không đăng ký body parser multipart (`@fastify/multipart` không được nạp ở Gateway), cho phép stream nhị phân truyền thẳng qua socket xuống service nghiệp vụ (Trading/User) nhằm tiết kiệm RAM và CPU.

#### c. Propagate Request ID & Chuẩn Hóa Lỗi Downstream (`src/hooks/request-id.ts`, `src/errors/error-handler.ts`)
- `request.headers['x-request-id']` được cập nhật đồng bộ với `traceId`, giúp `@fastify/http-proxy` tự động gắn `X-Request-Id` chuyển tiếp sang upstream.
- Khi upstream microservice offline hoặc gặp lỗi kết nối socket (`ECONNREFUSED`, `FST_REPLY_FROM_INTERNAL_SERVER_ERROR`), Gateway chặn lỗi và trả về JSON chuẩn theo Contract v2.1:
```json
{
  "timestamp": "2026-11-22T07:30:46.000Z",
  "status": 503,
  "code": "DEPENDENCY_UNAVAILABLE",
  "message": "Upstream service is currently unavailable or unreachable.",
  "path": "/api/v1/listings",
  "traceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

---

## 4. Danh Sách File Đã Tạo / Cập Nhật Trong Phase 4

| Đường dẫn file | Trạng thái | Mô tả trách nhiệm |
|---|---|---|
| `src/plugins/reverse-proxy.ts` | **Tạo mới** | Đăng ký bảng định tuyến reverse proxy cho 6 microservices và WS proxy |
| `src/hooks/payload-limit.ts` | **Tạo mới** | PreHandler kiểm tra Content-Length <= 5 MiB cho multipart upload |
| `src/hooks/request-id.ts` | **Cập nhật** | Gán `request.headers['x-request-id']` để chuyển tiếp `traceId` downstream |
| `src/errors/error-handler.ts` | **Cập nhật** | Bắt lỗi `ECONNREFUSED` / proxy error và chuẩn hóa về 503 `DEPENDENCY_UNAVAILABLE` |
| `src/app.ts` | **Cập nhật** | Đăng ký `payloadLimitHook` và `reverseProxyPlugin` |
| `test/helpers/mock-upstreams.ts` | **Tạo mới** | Mock HTTP Upstream Servers phục vụ kiểm thử proxy và ghi nhận headers/requests |
| `test/integration/proxy-routing.test.ts` | **Tạo mới** | Bộ kiểm thử tích hợp 11 test case kiểm tra định tuyến, headers, streaming upload |
| `reports/phase-4-report.md` | **Tạo mới** | Báo cáo chi tiết Phase 4 |

---

## 5. Kết Quả Kiểm Thử (Test Verification)

Toàn bộ test suite gồm 57 test cases đã vượt qua 100%:
```
 RUN  v3.2.7 D:/UNIVERSITY_PTIT/YEAR_4/PTPM_HDV/api-gateway

 ✓ test/unit/env.test.ts (5 tests)
 ✓ test/unit/public-keys.test.ts (5 tests)
 ✓ test/integration/gateway-security.test.ts (6 tests)
 ✓ test/integration/jwt-verification.test.ts (13 tests)
 ✓ test/integration/proxy-routing.test.ts (11 tests)
 ✓ test/integration/base-gateway.test.ts (8 tests)
 ✓ test/integration/access-state.test.ts (9 tests)

 Test Files  7 passed (7)
      Tests  57 passed (57)
   Duration  5.07s
```

### Chi tiết 11 test cases của Phase 4 (`proxy-routing.test.ts`):
1. `TC-PROXY-01`: Chuyển tiếp route public `/api/v1/auth/login` đến User Service (Port 8081).
2. `TC-PROXY-02`: Chuyển tiếp route protected `/api/v1/listings` đến Trading Service (Port 8083) kèm `Authorization` và `X-Request-Id`.
3. `TC-PROXY-03`: Chuyển tiếp route protected `/api/v1/plots` đến Farming Service (Port 8082).
4. `TC-PROXY-04`: Chuyển tiếp route protected `/api/v1/conversations` đến Chat Service (Port 8084).
5. `TC-PROXY-05`: Chuyển tiếp route protected `/api/v1/payments` đến Payment Service (Port 8085).
6. `TC-PROXY-06`: Chuyển tiếp route protected `/api/v1/notifications` đến Notification Service (Port 8086).
7. `TC-PROXY-07`: Route Guard chặn cứng `GET /api/v1/plots/:id/summary` với 403 `FORBIDDEN` trước khi chạm vào Farming Service upstream.
8. `TC-PROXY-08`: Strip sạch các client headers giả mạo (`x-user-id`, `x-user-role`, `x-service-key`) trước khi proxy sang upstream.
9. `TC-MEDIA-01`: Từ chối payload upload vượt quá 5 MiB với mã lỗi `413 PAYLOAD_TOO_LARGE` (§18).
10. `TC-MEDIA-02`: Cho phép stream upload hợp lệ (<= 5 MiB) nguyên vẹn qua Gateway xuống upstream mà không buffer.
11. `TC-PROXY-09`: Xử lý upstream offline trả về `503 DEPENDENCY_UNAVAILABLE` chuẩn contract.

---

## 6. Kết Luận & Sẵn Sàng
Phase 4 đã hoàn thành xuất sắc toàn bộ mục tiêu đề ra, tuân thủ nghiêm ngặt kiến trúc Fastify Gateway, các tiêu chuẩn bảo mật trong `BA - SOA.md`. Mã nguồn sẵn sàng để commit, tạo Pull Request và merge vào nhánh `develop`.
