# Fastify API Gateway — Agriculture Management Platform (Port 8080)

Fastify API Gateway for the Agriculture Management Platform Microservices System.

## Technology Stack
- **Runtime:** Node.js (v20+)
- **Language:** TypeScript
- **Framework:** Fastify v5
- **Security:** RS256 JWT Verification (Multi-kid Key Rotation), CORS allowlist, Header Sanitization, Edge Route Guard
- **Validation:** Zod
- **Testing:** Vitest

## Getting Started

### 1. Environment Configuration
Copy `.env.example` to `.env` and fill in required values:
```bash
cp .env.example .env
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Build and Test
```bash
npm run build
npm test
```

## Documentation
- Specifications: [docs/BA - SOA.md](docs/BA%20-%20SOA.md)
- Implementation Plan: [docs/api-gateway-implementation-plan.md](docs/api-gateway-implementation-plan.md)
- Phase Reports: [reports/](reports/)
