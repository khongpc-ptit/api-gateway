# BÁO CÁO HOÀN THÀNH PHASE 2 — EDGE SECURITY, CORS & JWT RS256
## FASTIFY API GATEWAY (PORT 8080)

> **Dự án:** Agriculture Management Platform — Microservices Architecture  
> **Service:** `api-gateway` (Port `8080`)  
> **Phase:** Phase 2 — Bảo mật Biên, CORS & Xác thực JWT RS256 Multi-kid (Edge Security & JWT)  
> **Trạng thái:** ✅ **HOÀN THÀNH (100% PASS - 37/37 TESTS)**  
> **Căn cứ tài liệu:** `BA - SOA.md` (Contract chung MVP v2.1) & `docs/api-gateway-implementation-plan.md`

---

## 1. MỤC TIÊU PHASE 2 & KẾT QUẢ ĐẠT ĐƯỢC

| Mục tiêu đề ra trong Kế hoạch | Kết quả triển khai thực tế | Trạng thái |
|:---|:---|:---:|
| Cấu hình CORS nghiêm ngặt theo BA §17 | Plugin `@fastify/cors` cấu hình theo `PUBLIC_APP_ORIGIN`, `credentials: false`, cấm wildcard, xử lý preflight `OPTIONS` trả về `204 No Content` | ✅ Đạt |
| Strip sạch các header giả mạo từ client | Hook `onRequest` tại `src/hooks/strip-headers.ts` xóa hoàn toàn `x-user-id`, `x-user-role`, `x-service-key` trước khi vào pipeline | ✅ Đạt |
| Chặn cứng route nội bộ `/internal/**` | Hook `onRequest` tại `src/hooks/route-guard.ts` chặn toàn bộ request `/internal/**` trả về `404 NOT_FOUND` chuẩn contract | ✅ Đạt |
| Chặn cứng route đặc biệt `GET /plots/:id/summary` | Chặn route tóm tắt Plot tại Gateway trả về `403 FORBIDDEN` (chỉ Trading Service được gọi nội bộ qua service key) | ✅ Đạt |
| Quản lý tập Public Key RS256 theo Key ID (`kid`) | Xây dựng lớp `PublicKeyStore` tại `src/config/public-keys.ts` lưu trữ map `kid -> PEM`, hỗ trợ nạp từ JSON và xoay vòng khóa | ✅ Đạt |
| Phân loại Public Routes vs Protected Routes | Allowlist các endpoint auth public (`login`, `register`, `otp`, `refresh`, `/health`); `POST /auth/logout` bắt buộc là Protected Route | ✅ Đạt |
| Thẩm định JWT RS256 & gán context người dùng | Hook `preHandler` tại `src/hooks/jwt-verify.ts` kiểm tra chữ ký `RS256`, `iss`, `aud`, `exp`, `clockSkew: 60s`, UUID subject, gắn `request.user` | ✅ Đạt |
| Kiểm thử tự động (Unit & Integration tests) | Bổ sung 24 test cases mới (tổng 37 test cases toàn bộ dự án), 100% test pass, TypeScript biên dịch 0 lỗi | ✅ Đạt |

---

## 2. KIẾN TRÚC & THIẾT KẾ KỸ THUẬT ÁP DỤNG

### 2.1. Thứ tự thực thi Lifecycle Hooks
Tại Phase 2, chu trình xử lý một request tại Fastify API Gateway được chuẩn hóa như sau:

```
[ Request đến Gateway ]
          │
          ▼
┌────────────────────────────────────────────────────────┐
│ 1. @fastify/cors:                                      │
│    - Thẩm định Origin: chỉ cho phép PUBLIC_APP_ORIGIN  │
│    - Xử lý OPTIONS Preflight -> Trả 204 ngay lập tức   │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 2. onRequest Hooks:                                    │
│    - requestIdHook: Gán/validate traceId               │
│    - stripSpoofedHeadersHook: Xóa x-user-id,           │
│      x-user-role, x-service-key                        │
│    - routeGuardHook:                                   │
│      • Nếu /internal/** -> 404 NOT_FOUND               │
│      • Nếu GET /plots/:id/summary -> 403 FORBIDDEN     │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 3. Router Matching (Fastify Internal):                 │
│    - Nếu route không tồn tại (routeOptions.url === undefined)│
│      -> Bỏ qua preHandler auth -> Trả 404 NOT_FOUND    │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 4. preHandler Hook (jwtVerifyHook):                    │
│    - Kiểm tra isPublicRoute() -> Bỏ qua nếu là public  │
│    - Trích xuất Bearer token                           │
│    - Decode unverified header -> Lấy 'kid' & check RS256│
│    - Lấy Public Key từ PublicKeyStore                  │
│    - Verify chữ ký, iss=urn:soa:user-service,          │
│      aud=soa-api, exp với clockTolerance = 60s         │
│    - Validate sub là UUID, role là FARMER/TRADER/ADMIN │
│    - Gắn request.user = { accountId, role, jti, ... }  │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
                  [ Route Handler ]
```

### 2.2. Cơ chế Xoay vòng Khóa (Key Rotation Overlap ≥ 16 phút)
- Theo đặc tả BA §19: Token access có hạn 15 phút + dung sai trôi đồng hồ 60 giây = 16 phút overlap.
- `PublicKeyStore` duy trì danh sách `Map<kid, PEM>` trong bộ nhớ:
  - Cho phép nạp đồng thời nhiều cặp khóa (ví dụ: `key-2026-v1` và `key-2026-v2`).
  - Khi token gửi đến mang `kid` nào, Gateway sẽ tự động tra cứu public key tương ứng để thẩm định chữ ký.
  - Cho phép thêm key mới (`addKey()`) trong runtime mà không cần restart server hay gọi ra dịch vụ JWKS bên ngoài.

### 2.3. Quy tắc Route Public vs Protected (§4, §17)
- **Public Routes:**
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/verify-otp`
  - `POST /api/v1/auth/resend-otp`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `GET /health`
- **Protected Routes:**
  - `POST /api/v1/auth/logout`: Bắt buộc phải có token hợp lệ để xác định danh tính account và thu hồi refresh token trong session.
  - Mọi route nghiệp vụ khác (`/api/v1/users/**`, `/api/v1/plots/**`, `/api/v1/listings/**`, `/api/v1/conversations/**`, `/api/v1/payments/**`, `/api/v1/notifications/**`).

---

## 3. DANH SÁCH THƯ VIỆN & CÔNG NGHỆ BỔ SUNG

| Thư viện / Module | Vai trò & Trách nhiệm trong Phase 2 |
|:---|:---|
| **@fastify/cors** | Triển khai chính sách CORS nghiêm ngặt tại tầng biên, chặn các origin lạ, hỗ trợ preflight cache 24h |
| **jsonwebtoken** | Giải mã unverified header (`jwt.decode`) để lấy `kid` và thực hiện xác thực chữ ký RS256 (`jwt.verify`) |
| **node:crypto** | Thẩm định tính toàn vẹn và cú pháp của chuỗi PEM RSA Public Key (`crypto.createPublicKey`) |
| **uuid** | Thẩm định định dạng UUID v4 hợp lệ của claim `sub` (accountId) trong JWT payload |

---

## 4. DANH MỤC CÁC FILE ĐÃ TẠO / CẬP NHẬT

```
api-gateway/
├── src/
│   ├── app.ts                       # CẬP NHẬT: Đăng ký CORS, stripSpoofedHeaders, routeGuard, jwtVerify
│   ├── config/
│   │   └── public-keys.ts           # MỚI: Lớp PublicKeyStore quản lý multi-kid RS256 keys
│   ├── hooks/
│   │   ├── strip-headers.ts         # MỚI: Hook onRequest strip x-user-id, x-user-role, x-service-key
│   │   ├── route-guard.ts           # MỚI: Hook onRequest chặn /internal/** và plots/:id/summary
│   │   └── jwt-verify.ts            # MỚI: Hook preHandler verify JWT RS256 & multi-kid
│   └── plugins/
│       └── cors.ts                  # MỚI: Cấu hình CORS options chuẩn theo BA §17
├── test/
│   ├── helpers/
│   │   └── token-helper.ts          # MỚI: Helper sinh cặp key RSA và tạo JWT test với các options
│   ├── unit/
│   │   └── public-keys.test.ts      # MỚI: Unit test cho PublicKeyStore (5 tests)
│   └── integration/
│       ├── gateway-security.test.ts # MỚI: Test chặn /internal, plots summary, strip header, CORS (6 tests)
│       ├── jwt-verification.test.ts # MỚI: Test RS256, iss, aud, exp, clockSkew, multi-kid (13 tests)
│       └── base-gateway.test.ts     # CẬP NHẬT: Đồng bộ test suite base gateway với auth layer (8 tests)
└── reports/
    └── phase-2-report.md            # MỚI: Báo cáo hoàn thành Phase 2
```

---

## 5. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG & BIÊN DỊCH

### 5.1. Kết quả TypeScript Compilation (`npm run build`)
```bash
> api-gateway@1.0.0 build
> rimraf dist && tsc
# Output: Exit code 0, không có bất kỳ lỗi biên dịch nào.
```

### 5.2. Kết quả Test Runner Vitest (`npm test`)
```bash
 RUN  v3.2.7 D:/UNIVERSITY_PTIT/YEAR_4/PTPM_HDV/api-gateway

 ✓ test/unit/env.test.ts (5 tests) 4ms
 ✓ test/unit/public-keys.test.ts (5 tests) 5ms
 ✓ test/integration/base-gateway.test.ts (8 tests) 40ms
 ✓ test/integration/jwt-verification.test.ts (13 tests) 70ms
 ✓ test/integration/gateway-security.test.ts (6 tests) 23ms

 Test Files  5 passed (5)
      Tests  37 passed (37)
   Duration  893ms
```

#### Chi tiết 24 Test Cases mới của Phase 2:
- `test/unit/public-keys.test.ts`:
  - `loads valid key pair from JSON string` (PASS)
  - `supports multiple keys for rotation overlap` (PASS)
  - `allows dynamic addition of new key without restart` (PASS)
  - `throws error when JSON format is invalid` (PASS)
  - `throws error when public key PEM is corrupted` (PASS)
- `test/integration/gateway-security.test.ts`:
  - `TC-SEC-01: Blocks internal endpoints (/internal/**) with 404 NOT_FOUND` (PASS)
  - `TC-SEC-02: Blocks GET /api/v1/plots/:plotId/summary with 403 FORBIDDEN` (PASS)
  - `Does not block regular plot routes like GET /api/v1/plots/:plotId` (PASS)
  - `TC-SEC-03: Strips spoofed client headers (x-user-id, x-user-role, x-service-key)` (PASS)
  - `TC-CORS-01: Handles CORS preflight for allowed origin (PUBLIC_APP_ORIGIN)` (PASS)
  - `TC-CORS-02: Rejects CORS preflight for unallowed origin` (PASS)
- `test/integration/jwt-verification.test.ts`:
  - `TC-AUTH-01: Public routes bypass JWT verification completely` (PASS)
  - `TC-AUTH-02: POST /api/v1/auth/logout is PROTECTED and requires valid JWT` (PASS)
  - `TC-AUTH-03: Protected route without Authorization header returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-04: Non-Bearer scheme returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-05: Token with algorithm other than RS256 is rejected with 401` (PASS)
  - `TC-AUTH-06: Token missing kid header returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-07: Token with unknown kid returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-08: Token with mismatched RSA signature returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-09: Token with wrong issuer or audience returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-10: Token expired beyond 60s clock skew returns 401 UNAUTHORIZED` (PASS)
  - `TC-AUTH-11: Token expired within 60s clock skew is tolerated and accepted (§19)` (PASS)
  - `TC-AUTH-12: Multi-kid Key Rotation overlap: both kid-1 and kid-2 succeed` (PASS)
  - `Attaches verified user identity claims to request.user` (PASS)

---

## 6. KẾT LUẬN & SẴN SÀNG CHO PHASE 3

Lớp bảo mật biên và xác thực JWT RS256 với cơ chế xoay vòng khóa không downtime đã được hoàn thiện 100%, bảo vệ tuyệt đối cổng vào của hệ sinh thái Microservices.

**Kế hoạch tiếp theo (Phase 3):**
1. Xây dựng HTTP Client bằng `undici` tại `src/services/access-state.client.ts` để gọi đồng bộ sang User Service: `GET /internal/v1/accounts/{accountId}/access-state`.
2. Truyền header nội bộ `X-Service-Key` và `X-Request-Id` (`traceId`).
3. Cài đặt timeout cứng `1000ms` bằng `AbortSignal.timeout(1000)`.
4. Triển khai cơ chế **Fail-Closed**:
   - User Service timeout hoặc lỗi mạng -> `503 ACCESS_STATE_UNAVAILABLE`.
   - Trạng thái `LOCKED`, `INACTIVE`, `UNVERIFIED` hoặc `accessAllowed === false` -> `403 ACCOUNT_NOT_ACTIVE`.
   - Trạng thái `ACTIVE` và `accessAllowed === true` -> cho phép request đi tiếp.
