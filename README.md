# Docsup

> Your family's documents. Securely organized.

Docsup is a privacy-first family document vault. The repository starts with a Next.js web application, a PostgreSQL/Prisma domain model, secure session primitives, tenant-scoped REST endpoints, an AI provider gateway, and deployment scaffolding.

## Status

The core foundation is implemented: family and profile data modeling, RBAC, session-backed authentication primitives, Google OAuth callback, OTP challenge storage, family-scoped document/search APIs, approval and audit endpoints, signed-share token model, AI provider abstraction for Gemini/Groq, security headers, and a responsive product UI. Object storage and an external OTP delivery adapter must be configured before accepting production uploads.

## Quick start

```bash
cp .env.example .env
# edit DATABASE_URL and SESSION_SECRET (32+ random characters)
docker compose up -d
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
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
- `prisma/schema.prisma` — tenant-aware schema for users, families, profiles, documents, versions, metadata, jobs, shares, notifications, and audit logs.
- `docker-compose.yml` — local PostgreSQL and Redis dependencies.
- `docs/` — security, AI, API, database, deployment, privacy, and development notes.

## Security posture

Documents are never public by default. Data access queries verify family membership. Original files are modeled as immutable document versions. Share tokens and sessions are stored hashed. AI keys remain server-side; AI output is untrusted and processing failures do not block the core vault. Before production, wire a private S3-compatible adapter, malware quarantine/scanning, a transactional email/SMS OTP provider, a queue worker, and managed secret storage.

## Quality commands

```bash
npm run typecheck
npm run build
npm run lint
```
