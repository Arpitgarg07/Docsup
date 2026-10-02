# Docsup

> Your family's documents. Securely organized.

Docsup is a privacy-first family document vault. The repository starts with a Next.js web application, a PostgreSQL/Prisma domain model, secure session primitives, tenant-scoped REST endpoints, an AI provider gateway, and deployment scaffolding.

## Status

The core foundation is implemented: family/profile onboarding and RBAC, session-backed authentication primitives, Google OAuth callback, OTP challenge storage, family-scoped document/search APIs, Appwrite private-storage upload/download/delete flows, approval and audit endpoints, signed-share token model, AI provider abstraction for Gemini/Groq, security headers, and a responsive product UI. Appwrite credentials and Resend email OTP must be configured and live-verified before relying on normal end-user sign-in. See [family onboarding](docs/onboarding.md), [search and discovery](docs/search.md), the [feature matrix](docs/feature-matrix.md), and [email authentication setup](docs/authentication.md) for current boundaries.

## Quick start

```bash
cp .env.example .env
# edit DATABASE_URL and SESSION_SECRET (32+ random characters)
# Docker Compose is optional; use it only if you need local PostgreSQL/Redis.
docker compose up -d
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

PostgreSQL is required by the application. Docker is optional when PostgreSQL is provided another way. Redis is optional and is not required for the MVP storage or AI-recording flow.

For Appwrite Cloud storage, configure the server-only `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_BUCKET_ID`, and `SESSION_SECRET` values before running:

```bash
npm run storage:setup
```

Open `http://localhost:3000`. The product landing page links to the dashboard experience at `/dashboard`. Health check: `GET /api/health`.

For local seed data:

```bash
npm run db:seed
```

Never use real personal documents in seed data. Keep `.env` out of version control.

## Architecture

- `apps/web/app` — Next.js App Router UI and REST route handlers.
- `apps/web/lib/auth.ts` — opaque, hashed, rotating-ready HttpOnly session foundation.
- `apps/web/lib/permissions.ts` — capability map; authorization is enforced server-side.
- `apps/web/lib/ai.ts` — provider interface with Gemini/Groq routing and guardrails.
- `apps/web/lib/storage.ts` — Appwrite private-storage adapter behind the `StorageProvider` interface.
- `prisma/schema.prisma` — tenant-aware schema for users, families, profiles, documents, versions, metadata, jobs, shares, notifications, and audit logs.
- `docker-compose.yml` — optional local PostgreSQL and Redis dependencies.
- `docs/` — security, AI, API, database, deployment, privacy, and development notes.

## Security posture

Documents are never public by default. Data access queries verify family membership and profile ownership. Original files are immutable versions in an Appwrite Cloud private bucket; public Appwrite file URLs are never returned. Server-only Appwrite credentials and HMAC download-token secrets stay outside browser bundles. Share tokens and sessions are stored hashed. AI keys remain server-side; AI output is untrusted and processing failures do not block the core vault. Before production, verify Resend email OTP delivery and abuse controls, and add managed secret storage and operational backup/restore and malware-scanning verification. A queue worker can be added when needed; email OTP does not require Redis or Docker.

## Quality commands

```bash
npm run typecheck
npm run build
npm run lint
```
