# BÁO CÁO HOÀN THÀNH PHASE 3 — ACCESS-STATE ENFORCEMENT
## FASTIFY API GATEWAY (PORT 8080)

> **Dự án:** Agriculture Management Platform — Microservices Architecture  
> **Service:** `api-gateway` (Port `8080`)  
> **Phase:** Phase 3 — Kiểm tra Trạng thái Tài khoản Tức thời (Access-State Enforcement)  
> **Trạng thái:** ✅ **HOÀN THÀNH (100% PASS - 46/46 TESTS)**  
> **Căn cứ tài liệu:** `BA - SOA.md` (Contract chung MVP v2.1 §4, §16, §19) & `docs/api-gateway-implementation-plan.md`

---

## 1. MỤC TIÊU PHASE 3 & KẾT QUẢ ĐẠT ĐƯỢC

| Mục tiêu đề ra trong Kế hoạch | Kết quả triển khai thực tế | Trạng thái |
|:---|:---|:---:|
| Xây dựng HTTP Client gọi User Service | Triển khai lớp `AccessStateClient` tại `src/services/access-state.client.ts` sử dụng thư viện `undici` | ✅ Đạt |
| Gọi đúng endpoint nội bộ theo BA §4 | Endpoint: `GET /internal/v1/accounts/{accountId}/access-state` với `accountId` trích xuất từ JWT sub đã verify | ✅ Đạt |
| Truyền đúng header bảo mật nội bộ | Tự động gửi kèm `X-Service-Key` (từ `GATEWAY_TO_USER_SERVICE_KEY`) và `X-Request-Id` (`traceId`) | ✅ Đạt |
| Thực thi Timeout cứng 1000ms | Sử dụng `AbortSignal.timeout(env.ACCESS_STATE_TIMEOUT_MS)` ngắt kết nối chính xác sau 1000ms nếu upstream chậm trễ | ✅ Đạt |
| Cơ chế Fail-Closed (User Service down/timeout) | Khi User Service timeout (>1000ms), sập cổng mạng, hoặc lỗi 5xx, Gateway lập tức từ chối và trả về `503 ACCESS_STATE_UNAVAILABLE` | ✅ Đạt |
| Khóa tài khoản tức thời tại biên (Real-time Edge Lock) | Nếu tài khoản có `status` là `LOCKED`, `INACTIVE`, `UNVERIFIED` hoặc `accessAllowed !== true`, Gateway từ chối ngay với `403 ACCOUNT_NOT_ACTIVE` | ✅ Đạt |
| Không cache trạng thái ACTIVE | Không lưu cache in-memory/Redis trạng thái `ACTIVE` (đảm bảo tài khoản bị Admin khóa hoặc điểm uy tín về 0 bị chặn ngay) | ✅ Đạt |
| Phân tách Public Routes vs Protected Routes | Public routes hoàn toàn không kích hoạt cuộc gọi access-state, tiết kiệm băng thông nội bộ | ✅ Đạt |
| Kiểm thử tự động với Mock Server | Xây dựng `MockUserService` bằng `node:http` giả lập máy chủ User Service thực tế; 9 test cases mới pass 100% | ✅ Đạt |

---

## 2. KIẾN TRÚC & THIẾT KẾ KỸ THUẬT ÁP DỤNG

### 2.1. Luồng Xác thực & Thẩm định Quyền tại Biên (Edge Authentication & Authorization)
Mỗi request gửi tới endpoint protected trải qua 2 chốt chặn bảo mật liên tiếp trong Fastify `preHandler`:

```
[ Client Request ]
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ 1. jwtVerifyHook (Chốt 1: Xác thực Cryptographic)      │
│    - Kiểm tra chữ ký RS256 với Public Key tương ứng   │
│    - Kiểm tra iss = urn:soa:user-service, aud = soa-api│
│    - Kiểm tra exp (hạn dùng token + dung sai 60s)      │
│    - Trích xuất accountId = sub (UUID), role           │
│    - Gán thông tin vào request.user                    │
└─────────────────────────┬──────────────────────────────┘
                          │ (Hợp lệ)
                          ▼
┌────────────────────────────────────────────────────────┐
│ 2. accessStateHook (Chốt 2: Thẩm định Trạng thái Sống) │
│    - Gọi: GET /internal/v1/accounts/:id/access-state   │
│    - Header: X-Service-Key, X-Request-Id (traceId)     │
│    - Timeout: 1000ms (undici AbortSignal)              │
│    - KHÔNG cache trạng thái ACTIVE                     │
│                                                        │
│    [Đánh giá kết quả từ User Service]:                │
│    ├── Timeout (> 1000ms) ──────────> 503 ACCESS_STATE_UNAVAILABLE
│    ├── Lỗi mạng / Crash ────────────> 503 ACCESS_STATE_UNAVAILABLE
│    ├── STATUS != ACTIVE ────────────> 403 ACCOUNT_NOT_ACTIVE
│    ├── accessAllowed == false ──────> 403 ACCOUNT_NOT_ACTIVE
│    └── ACTIVE & accessAllowed=true ─> [Cho phép đi tiếp]
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
            [ Chuyển tiếp sang Proxy Layer ]
```

### 2.2. Xử lý Timeout và Quản lý Socket với `undici`
- Node.js runtime `undici` được sử dụng để tối ưu hóa hiệu năng gọi nội bộ.
- Cơ chế timeout:
  ```typescript
  signal: AbortSignal.timeout(this.env.ACCESS_STATE_TIMEOUT_MS)
  ```
- Khi thời gian gọi vượt quá ngưỡng `1000ms`, `undici` kích hoạt ngoại lệ `TimeoutError`/`AbortError`. Gateway lập tức chuyển đổi ngoại lệ này thành `AppError.accessStateUnavailable()` với thông báo rõ ràng: `"User service access-state verification timed out after 1000ms"`.
- Khi server trả về mã lỗi HTTP không phải 200, socket được giải phóng bằng `response.body.dump()` để ngăn ngừa cạn kiệt tài nguyên connection pool.

---

## 3. DANH SÁCH THƯ VIỆN & CÔNG NGHỆ BỔ SUNG

| Thư viện / Module | Vai trò trong Phase 3 |
|:---|:---|
| **undici** | HTTP Client chính thức hiệu năng cao của Node.js, hỗ trợ native `AbortSignal.timeout`, kết nối pool nội bộ |
| **node:http** | Tạo `MockUserService` chạy máy chủ HTTP độc lập phục vụ kiểm thử tích hợp không cần phụ thuộc bên ngoài |

---

## 4. DANH MỤC CÁC FILE ĐÃ TẠO / CẬP NHẬT

```
api-gateway/
├── src/
│   ├── app.ts                       # CẬP NHẬT: Đăng ký createAccessStateHook trong preHandler
│   ├── hooks/
│   │   └── access-state.ts          # MỚI: Fastify preHandler hook gọi AccessStateClient
│   └── services/
│       └── access-state.client.ts   # MỚI: Undici Client gọi User Service với timeout 1000ms
├── test/
│   ├── helpers/
│   │   └── mock-user-service.ts     # MỚI: Mock HTTP Server giả lập User Service (delay, error, status)
│   └── integration/
│       ├── access-state.test.ts     # MỚI: 9 test cases kiểm thử toàn diện kịch bản access-state
│       ├── base-gateway.test.ts     # CẬP NHẬT: Inject DummyAccessStateClient
│       ├── gateway-security.test.ts # CẬP NHẬT: Inject DummyAccessStateClient
│       └── jwt-verification.test.ts # CẬP NHẬT: Inject DummyAccessStateClient
└── reports/
    └── phase-3-report.md            # MỚI: Báo cáo hoàn thành Phase 3
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

 ✓ test/unit/env.test.ts (5 tests) 5ms
 ✓ test/unit/public-keys.test.ts (5 tests) 4ms
 ✓ test/integration/gateway-security.test.ts (6 tests) 24ms
 ✓ test/integration/base-gateway.test.ts (8 tests) 47ms
 ✓ test/integration/jwt-verification.test.ts (13 tests) 104ms
 ✓ test/integration/access-state.test.ts (9 tests) 4153ms

 Test Files  6 passed (6)
      Tests  46 passed (46)
   Duration  5.01s
```

#### Chi tiết 9 Acceptance Test Cases của Phase 3 (`test/integration/access-state.test.ts`):
- `TC-STATE-01: Allows request when account is ACTIVE and accessAllowed is true` (PASS)
- `TC-STATE-02: Rejects request with 403 ACCOUNT_NOT_ACTIVE when account is LOCKED` (PASS - Acceptance Test 16.2)
- `TC-STATE-03: Rejects request with 403 ACCOUNT_NOT_ACTIVE when account is INACTIVE` (PASS)
- `TC-STATE-04: Rejects request with 403 ACCOUNT_NOT_ACTIVE when account is UNVERIFIED` (PASS - Acceptance Test 16.1)
- `TC-STATE-05: Rejects request with 403 when status is ACTIVE but accessAllowed is false` (PASS)
- `TC-STATE-06: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service times out (>1000ms)` (PASS - Acceptance Test 16.1)
- `TC-STATE-07: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service is down (connection refused)` (PASS - Acceptance Test 16.1)
- `TC-STATE-08: Fail-closed: Returns 503 ACCESS_STATE_UNAVAILABLE when User Service returns 500 error` (PASS)
- `TC-STATE-09: Public routes bypass access-state check completely` (PASS)

---

## 6. KẾT LUẬN & SẴN SÀNG CHO PHASE 4

Cơ chế kiểm soát trạng thái tài khoản thời gian thực tại biên đã hoàn thiện, đáp ứng trọn vẹn tiêu chí chấp nhận Acceptance Test 16.1 & 16.2 của `BA - SOA.md`.

**Kế hoạch tiếp theo (Phase 4):**
1. Triển khai ma trận Reverse Proxy bằng `@fastify/http-proxy` kết nối 6 upstream services (`8081`–`8086`).
2. Giữ nguyên prefix `/api/v1` và chuyển tiếp nguyên vẹn header `Authorization: Bearer` cùng `X-Request-Id`.
3. Xử lý streaming nguyên vẹn cho multipart upload ảnh (≤ 5 MiB), từ chối sớm `413 PAYLOAD_TOO_LARGE` nếu vượt quá dung lượng.
4. Triển khai proxy nâng cấp WebSocket cho Chat Service (`8084`).
