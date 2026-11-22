# Báo Cáo Triển Khai Phase 5: Suite Kiểm Thử Chấp Nhận Toàn Diện (Acceptance Test Suite)

## 1. Thông Tin Tổng Quan
- **Service:** `api-gateway` (Port `8080`)
- **Phase:** 5 — Full Acceptance Test Suite
- **Branch:** `feat/phase-5-acceptance-tests`
- **Tài liệu căn cứ:** `docs/BA - SOA.md` (MVP Contract v2.1 baseline: §2 Ownership, §3 Error Contract, §4 Security & User API, §10 Error Contract, §15 Gateway Port Matrix, §16 Acceptance Tests, §17 Frontend/CORS, §18 Upload/Media, §19 Vận hành/Env)
- **Kế hoạch đối chiếu:** `docs/api-gateway-implementation-plan.md` (Phần 5: Phase 5 & Phần 6: Ma trận 23 Test Cases)

---

## 2. Mục Tiêu Của Phase 5
1. Xây dựng bộ kiểm thử tích hợp toàn diện (`test/integration/acceptance-criteria.test.ts`) bằng `fastify.inject()` và `vitest`, bao phủ 100% các tiêu chí chấp nhận tại Mục 16 của `BA - SOA.md` và 23 Test Cases tại Phần 6 của Kế hoạch triển khai.
2. Kiểm tra độc lập và toàn diện các nhóm chức năng cốt lõi:
   - **Nhóm 1: Bảo mật biên & Route Guard** (chặn `/internal/**`, chặn `GET /plots/:id/summary`, loại bỏ header giả mạo).
   - **Nhóm 2: Cấu hình CORS** (allowlist nghiêm ngặt theo `PUBLIC_APP_ORIGIN`, cấm wildcard, `credentials: false`, phản hồi OPTIONS preflight 204).
   - **Nhóm 3: Xác thực JWT RS256 & Multi-kid Key Rotation** (bảo vệ logout, kiểm tra `iss`, `aud`, hạn dùng, dung sai trôi đồng hồ 60s, hỗ trợ nhiều `kid` xoay khóa không gián đoạn).
   - **Nhóm 4: Kiểm soát trạng thái tài khoản thời gian thực (Access-State)** (gọi User Service đồng bộ, fail-closed khi timeout 1000ms hoặc lỗi 500, chặn tài khoản `LOCKED`/`UNVERIFIED`).
   - **Nhóm 5: Reverse Proxy & Media Streaming** (bảo toàn prefix `/api/v1/...`, bảo toàn `Authorization: Bearer`, stream raw upload ảnh ≤ 5 MiB, từ chối > 5 MiB với 413).
   - **Nhóm 6: Chuẩn hóa Error Contract & Chống rò rỉ thông tin** (đảm bảo mọi response lỗi tuân thủ đúng 6 trường, không để lộ stack trace hay SQL).
3. Đảm bảo toàn bộ 80 bài kiểm thử (unit & integration) chạy pass 100%.

---

## 3. Kiến Trúc & Các Thư Viện Sử Dụng

### 3.1. Thư Viện & Công Cụ Kiểm Thử
- **`vitest` (v3.x)**: Test runner hiện đại, hỗ trợ ESM/NodeNext, chạy song song các suite kiểm thử với hiệu năng cao.
- **`fastify.inject()`**: Thư viện mô phỏng HTTP request trực tiếp vào Fastify engine mà không cần bind cổng TCP thực tế, giúp test chạy cực nhanh, độc lập và ổn định.
- **`Node.js http` & `net`**: Mock các microservices nội bộ (`MockUserService`, `MockUpstreamService`) để kiểm thử tích hợp end-to-end hành vi định tuyến, headers và streaming.
- **`jsonwebtoken` & Node.js `crypto`**: Sinh các cặp khóa RSA-2048 (`TEST_KEY_PAIR_1`, `TEST_KEY_PAIR_2`) và ký các JWT token phục vụ kiểm thử các góc cạnh bảo mật (valid, expired, clock skew, wrong iss/aud, rotation overlap).

### 3.2. Ma Trận 23 Test Cases Chấp Nhận (Acceptance Test Matrix)

| Mã Test Case | Tên kịch bản | Mô tả kiểm thử | Kết quả thực tế | Trạng thái |
|:---|:---|:---|:---|:---:|
| `TC-SEC-01` | Chặn route nội bộ `/internal` | Gửi request đến `/internal/v1/accounts/:id/access-state` | Trả về `404 NOT_FOUND` | **PASSED** |
| `TC-SEC-02` | Chặn route đặc biệt tóm tắt Plot | Gửi `GET /api/v1/plots/:id/summary` | Trả về `403 FORBIDDEN` | **PASSED** |
| `TC-SEC-03` | Xóa header giả mạo từ Client | Gửi kèm `x-user-id`, `x-user-role`, `x-service-key` | Upstream không nhận được các header này | **PASSED** |
| `TC-CORS-01`| Preflight CORS hợp lệ | Gửi `OPTIONS /api/v1/listings` từ `PUBLIC_APP_ORIGIN` | `204 No Content`, có origin allowlist, methods | **PASSED** |
| `TC-CORS-02`| Preflight CORS không hợp lệ | Gửi `OPTIONS /api/v1/listings` từ origin lạ | Không có header `Access-Control-Allow-Origin` | **PASSED** |
| `TC-AUTH-01`| Public route không cần JWT | Gửi `POST /api/v1/auth/login` không có token | Chuyển tiếp thành công xuống User Service | **PASSED** |
| `TC-AUTH-02`| Logout bắt buộc có JWT | Gửi `POST /api/v1/auth/logout` không có token | Trả về `401 UNAUTHORIZED` | **PASSED** |
| `TC-AUTH-03`| Protected route thiếu token | Gửi `GET /api/v1/plots` không có header `Authorization` | Trả về `401 UNAUTHORIZED` | **PASSED** |
| `TC-AUTH-04`| Token hết hạn quá clock skew | Gửi token có `exp` đã hết hạn 120s | Trả về `401 UNAUTHORIZED` | **PASSED** |
| `TC-AUTH-05`| Dung sai trôi đồng hồ (Clock Skew) | Gửi token có `exp` vừa hết hạn 30s (< 60s) | Xác thực thành công và proxy bình thường | **PASSED** |
| `TC-AUTH-06`| Sai Issuer hoặc Audience | Gửi token có `iss` hoặc `aud` không khớp cấu hình | Trả về `401 UNAUTHORIZED` | **PASSED** |
| `TC-AUTH-07`| Xoay vòng khóa (Multi-kid) | Gửi token ký bởi `key-v1` và `key-v2` | Cả 2 đều xác thực thành công | **PASSED** |
| `TC-AUTH-08`| Key ID (`kid`) không tồn tại | Gửi token có `kid=unknown-kid` | Trả về `401 UNAUTHORIZED` | **PASSED** |
| `TC-STATE-01`| Tài khoản ACTIVE hợp lệ | Mock User Service trả `status: ACTIVE, accessAllowed: true` | Cho phép đi qua và proxy xuống upstream | **PASSED** |
| `TC-STATE-02`| Tài khoản bị khóa (LOCKED) | Mock User Service trả `status: LOCKED, accessAllowed: false` | Trả về `403 ACCOUNT_NOT_ACTIVE` | **PASSED** |
| `TC-STATE-03`| Tài khoản chưa verify (UNVERIFIED)| Mock User Service trả `status: UNVERIFIED` | Trả về `403 ACCOUNT_NOT_ACTIVE` | **PASSED** |
| `TC-STATE-04`| User Service bị timeout (>1000ms)| Mock User Service phản hồi sau 1100ms | Fail-closed: `503 ACCESS_STATE_UNAVAILABLE` | **PASSED** |
| `TC-STATE-05`| User Service bị lỗi (500) | Mock User Service trả HTTP 500 | Fail-closed: `503 ACCESS_STATE_UNAVAILABLE` | **PASSED** |
| `TC-PROXY-01`| Giữ nguyên prefix `/api/v1` | Gửi `GET /api/v1/listings?category=vegetables` | Upstream nhận nguyên vẹn path và query | **PASSED** |
| `TC-PROXY-02`| Giữ nguyên Bearer token | Gửi `GET /api/v1/plots/plot-999` có Bearer token | Upstream nhận nguyên vẹn `Authorization` | **PASSED** |
| `TC-MEDIA-01`| Upload ảnh vượt quá 5 MiB | Gửi `POST` có `Content-Length > 5 MiB` | Trả về `413 PAYLOAD_TOO_LARGE` | **PASSED** |
| `TC-MEDIA-02`| Upload ảnh hợp lệ (<= 5 MiB) | Gửi payload nhị phân `image/jpeg` | Stream nguyên vẹn xuống upstream | **PASSED** |
| `TC-ERR-01`  | Chuẩn hóa Error Contract | Kiểm tra cấu trúc JSON của mọi response lỗi | Đủ 6 trường, không lộ stack trace / SQL | **PASSED** |

---

## 4. Danh Sách File Đã Tạo / Cập Nhật Trong Phase 5

| Đường dẫn file | Trạng thái | Mô tả trách nhiệm |
|---|---|---|
| `test/integration/acceptance-criteria.test.ts` | **Tạo mới** | Bộ kiểm thử chấp nhận toàn diện 23 test case ánh xạ theo BA §16 |
| `test/helpers/mock-user-service.ts` | **Cập nhật** | Hỗ trợ giả lập đồng thời endpoint nội bộ và endpoint proxy public của User Service |
| `reports/phase-5-report.md` | **Tạo mới** | Báo cáo chi tiết kết quả thực hiện Phase 5 |

---

## 5. Kết Quả Kiểm Thử (Verification Summary)

Toàn bộ hệ thống kiểm thử đạt tỷ lệ thành công 100% trên 8 test suite:
```
 RUN  v3.2.7 D:/UNIVERSITY_PTIT/YEAR_4/PTPM_HDV/api-gateway

 ✓ test/unit/env.test.ts (5 tests)
 ✓ test/unit/public-keys.test.ts (5 tests)
 ✓ test/integration/gateway-security.test.ts (6 tests)
 ✓ test/integration/base-gateway.test.ts (8 tests)
 ✓ test/integration/proxy-routing.test.ts (11 tests)
 ✓ test/integration/jwt-verification.test.ts (13 tests)
 ✓ test/integration/acceptance-criteria.test.ts (23 tests)
 ✓ test/integration/access-state.test.ts (9 tests)

 Test Files  8 passed (8)
      Tests  80 passed (80)
   Duration  5.09s
```

---

## 6. Kết Luận & Sẵn Sàng
Toàn bộ các tiêu chí nghiệm thu về tính bảo mật, tính nhất quán của dữ liệu lỗi, hiệu năng stream và cơ chế fail-closed của Fastify API Gateway đã được xác nhận đạt 100%. Nhánh `feat/phase-5-acceptance-tests` đã sẵn sàng để commit, tạo Pull Request và hợp nhất vào nhánh `develop`.
