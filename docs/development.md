# Development

Use Node 20+ and PostgreSQL 16. Redis is optional. Copy `.env.example` to `.env`, provide PostgreSQL either through Docker Compose or another local service, install packages, generate Prisma client, and run the migration. Configure all Appwrite server variables before running `npm run storage:setup`; do not use real personal documents.

Keep domain authorization in server-side route/service code. Add tests with the first production integrations, especially cross-family access, expired sessions, OTP abuse, malformed uploads, share revocation, and role boundaries. Run typecheck and build before review.
