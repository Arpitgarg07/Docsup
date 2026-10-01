# Development

Use Node 20+, PostgreSQL 16, and Redis 7. Copy `.env.example` to `.env`, start dependencies with Docker Compose, install packages, generate Prisma client, and run the migration.

Keep domain authorization in server-side route/service code. Add tests with the first production integrations, especially cross-family access, expired sessions, OTP abuse, malformed uploads, share revocation, and role boundaries. Run typecheck and build before review.
