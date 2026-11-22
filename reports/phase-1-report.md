# BÁO CÁO HOÀN THÀNH PHASE 1 — FOUNDATION & BASE CONFIG
## FASTIFY API GATEWAY (PORT 8080)

> **Dự án:** Agriculture Management Platform — Microservices Architecture  
> **Service:** `api-gateway` (Port `8080`)  
> **Phase:** Phase 1 — Khởi tạo Project & Cấu hình Nền tảng (Foundation & Base Config)  
> **Trạng thái:** ✅ **HOÀN THÀNH (100% PASS)**  
> **Căn cứ tài liệu:** `BA - SOA.md` (Contract chung MVP v2.1) & `docs/api-gateway-implementation-plan.md`

---

## 1. MỤC TIÊU PHASE 1 & KẾT QUẢ ĐẠT ĐƯỢC

| Mục tiêu đề ra trong Kế hoạch | Kết quả triển khai thực tế | Trạng thái |
|:---|:---|:---:|
| Khởi tạo dự án Node.js + TypeScript thuần dùng Fastify | Đã cấu hình `package.json`, `tsconfig.json` (ES2022, NodeNext), module resolution chuẩn ESM | ✅ Đạt |
| Nạp và thẩm định biến môi trường fail-fast bằng Zod | Đã tạo `src/config/env.ts` với `EnvSchema` kiểm tra chặt chẽ toàn bộ biến môi trường; ném lỗi và dừng nếu cấu hình sai | ✅ Đạt |
| Xử lý Request ID (`traceId`) xuyên suốt request lifecycle | Tạo hook `onRequest` tại `src/hooks/request-id.ts`, validate format UUID, sinh mới nếu thiếu và gắn response header `x-request-id` | ✅ Đạt |
| Cấu hình Pino Logger bảo vệ dữ liệu nhạy cảm | Cấu hình Pino với cơ chế Redact tự động xóa `authorization` và `x-service-key` khỏi log stream | ✅ Đạt |
| Chuẩn hóa 100% Error Contract theo BA §3 & §10 | Xây dựng `AppError`, `errorHandler` và `notFoundHandler` đảm bảo mọi phản hồi lỗi đều có format `{timestamp, status, code, message, path, traceId}` | ✅ Đạt |
| Endpoint `/health` kiểm tra trạng thái hoạt động | Đã triển khai `GET /health` trả về trạng thái UP, timestamp và tên service | ✅ Đạt |
| Viết kiểm thử tự động (Unit & Integration tests) | Đã viết 13 test case bao phủ toàn bộ các module của Phase 1 với tỷ lệ pass 13/13 | ✅ Đạt |

---

## 2. KIẾN TRÚC & THIẾT KẾ KỸ THUẬT ÁP DỤNG

### 2.1. Request ID & Traceability Lifecycle
- Sử dụng hook `onRequest` của Fastify:
  - Kiểm tra header `X-Request-Id` từ client gửi vào. Nếu là chuỗi UUID hợp lệ, Gateway sử dụng trực tiếp làm `traceId`.
  - Nếu thiếu hoặc client gửi chuỗi không đúng chuẩn UUID (ví dụ ký tự tùy tiện), Gateway tự động sinh UUID v4 mới.
  - Gắn `traceId` vào đối tượng `request.traceId` (thông qua TypeScript Declaration Merging trên `FastifyRequest`).
  - Đính kèm header `X-Request-Id: <traceId>` trên mọi phản hồi HTTP trả về cho client.

### 2.2. Error Contract Chuẩn hóa Tuyệt đối (BA §3, §10)
- Mọi lỗi tại Gateway (lỗi nghiệp vụ, lỗi validation, lỗi route không tồn tại, lỗi hệ thống) đều được format nhất quán:
  ```json
  {
    "timestamp": "2026-11-22T06:44:27.123Z",
    "status": 404,
    "code": "NOT_FOUND",
    "message": "Route not found",
    "path": "/api/v1/unknown",
    "traceId": "c4b3f2e1-4567-4890-a123-456789abcdef"
  }
  ```
- **Nguyên tắc bảo mật:** Khi xảy ra lỗi không mong đợi (HTTP 500 / unhandled exception), lỗi chi tiết kèm stack trace được ghi vào Pino log nội bộ với mức `ERROR` kèm `traceId`, nhưng phản hồi gửi về client được sanitize hoàn toàn: `message: "Internal server error"`, loại bỏ triệt để stack trace, câu lệnh SQL hoặc đường dẫn nội bộ.

### 2.3. Bảo mật Pino Logging
- Cấu hình redaction:
  ```typescript
  redact: [
    'req.headers.authorization',
    'req.headers["x-service-key"]',
    'headers.authorization',
    'headers["x-service-key"]',
  ]
  ```
  Ngăn chặn việc rò rỉ Bearer token hoặc khóa xác thực liên service vào hệ thống giám sát log tập trung.

---

## 3. DANH SÁCH THƯ VIỆN & CÔNG NGHỆ SỬ DỤNG

| Thư viện | Phiên bản | Vai trò & Lý do lựa chọn |
|:---|:---:|:---|
| **fastify** | `^5.2.1` | Core HTTP framework hiệu năng cao, cơ chế plugin và lifecycle hook chặt chẽ, hỗ trợ native async/await |
| **typescript** | `^5.8.2` | Ngôn ngữ phát triển chính, đảm bảo an toàn kiểu dữ liệu (Strict Mode) |
| **zod** | `^3.24.2` | Schema validation cho cấu hình môi trường (.env), hỗ trợ suy luận kiểu tự động (`z.infer`) |
| **dotenv** | `^16.4.7` | Nạp biến môi trường từ file `.env` vào `process.env` khi chạy local |
| **uuid** | `^11.1.0` | Tạo và thẩm định chuỗi UUID v4 chuẩn xác cho Request ID (`traceId`) |
| **vitest** | `^3.0.8` | Test runner siêu nhanh, hỗ trợ TypeScript native không cần build trung gian |
| **tsx** | `^4.19.3` | Trình thực thi TypeScript tức thời phục vụ quá trình development |
| **@fastify/cors** | `^11.0.1` | Plugin CORS chuẩn cho Fastify v5 (chuẩn bị cho Phase 2) |
| **@fastify/http-proxy** | `^11.6.0` | Plugin Reverse Proxy cho Fastify v5 (chuẩn bị cho Phase 4) |
| **jsonwebtoken** | `^9.0.2` | Thư viện xác thực JWT RS256 (chuẩn bị cho Phase 2) |
| **undici** | `^7.4.0` | HTTP Client chuẩn của Node.js runtime cho inter-service communication (Phase 3) |

---

## 4. DANH MỤC CÁC FILE ĐÃ TẠO

```
api-gateway/
├── .env.example                     # Mẫu biến môi trường chuẩn kèm hướng dẫn
├── .env                             # File cấu hình môi trường local (chứa key test)
├── .gitignore                       # Bỏ qua node_modules, dist, .env, log
├── package.json                     # Định nghĩa dependency và scripts (build, dev, test)
├── tsconfig.json                    # Cấu hình TypeScript compiler (NodeNext, ES2022, strict)
├── vitest.config.ts                 # Cấu hình test runner Vitest
├── src/
│   ├── app.ts                       # Hàm buildApp(): khởi tạo Fastify, gắn hook, error handler
│   ├── server.ts                    # Entrypoint: start HTTP server port 8080, graceful shutdown
│   ├── config/
│   │   └── env.ts                   # Schema Zod validate cấu hình môi trường
│   ├── constants/
│   │   ├── error-codes.ts           # Enum các mã lỗi theo BA §3 & §10
│   │   └── routes.ts                # Định nghĩa Public routes, Blocked routes, Special routes
│   ├── errors/
│   │   ├── app-error.ts             # Lớp AppError chuẩn hóa exception
│   │   └── error-handler.ts         # Fastify errorHandler & notFoundHandler theo Error Contract
│   └── hooks/
│       └── request-id.ts            # Hook onRequest: inject traceId & response header
├── test/
│   ├── unit/
│   │   └── env.test.ts              # Unit test cho Zod Env Validation (5 test cases)
│   └── integration/
│       └── base-gateway.test.ts     # Integration test cho App, Health, TraceId, Error (8 test cases)
└── reports/
    └── phase-1-report.md            # Báo cáo hoàn thành Phase 1
```

---

## 5. KẾT QUẢ KIỂM THỬ TỰ ĐỘNG & BIÊN DỊCH

### 5.1. Kết quả TypeScript Compilation (`npm run build`)
```bash
> api-gateway@1.0.0 build
> rimraf dist && tsc
# Output: Exit code 0, không có bất kỳ cảnh báo hoặc lỗi type checking nào.
```

### 5.2. Kết quả Test Runner Vitest (`npm test`)
```bash
 RUN  v3.2.7 D:/UNIVERSITY_PTIT/YEAR_4/PTPM_HDV/api-gateway

 ✓ test/unit/env.test.ts (5 tests) 4ms
   ✓ should load default configuration successfully
   ✓ should validate valid custom environment variables
   ✓ should reject invalid CORS origin URL
   ✓ should reject invalid JWT_PUBLIC_KEYS_JSON format
   ✓ should reject short GATEWAY_TO_USER_SERVICE_KEY
 ✓ test/integration/base-gateway.test.ts (8 tests) 40ms
   ✓ GET /health returns 200 with service status
   ✓ Injects and validates X-Request-Id header correctly
   ✓ Generates new UUID when X-Request-Id is invalid
   ✓ Returns standard Error Contract for unmatched routes (404 NOT_FOUND)
   ✓ Formats AppError.unauthorized into standard Error Contract (401)
   ✓ Formats AppError.accountNotActive into standard Error Contract (403)
   ✓ Sanitizes unexpected 500 errors and does not expose stack trace or database info
   ✓ Formats Fastify schema validation error into standard 400 VALIDATION_ERROR

 Test Files  2 passed (2)
      Tests  13 passed (13)
   Duration  697ms
```

---

## 6. KẾT LUẬN & SẴN SÀNG CHO PHASE 2

Toàn bộ nền móng của `api-gateway` (Port `8080`) đã được thiết lập vững chắc, đáp ứng 100% tiêu chí hoàn thành của Phase 1. 

**Kế hoạch tiếp theo (Phase 2):**
1. Triển khai cấu hình `@fastify/cors` theo chuẩn BA §17 (`PUBLIC_APP_ORIGIN`, `credentials: false`, cấm wildcard, xử lý `OPTIONS` preflight).
2. Xây dựng hook `strip-headers.ts` loại bỏ triệt để các header giả mạo từ client (`x-user-id`, `x-user-role`, `x-service-key`).
3. Xây dựng hook `route-guard.ts` chặn cứng `/internal/**` (404) và `GET /api/v1/plots/:plotId/summary` (403).
4. Xây dựng loader `public-keys.ts` quản lý pool Public Key RS256 theo `kid` hỗ trợ xoay vòng khóa không downtime.
5. Triển khai hook xác thực JWT RS256 (`iss`, `aud`, `exp`, `clockSkew: 60s`).
