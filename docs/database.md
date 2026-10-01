# Database

PostgreSQL with Prisma migrations is the source of truth. `FamilyMember` is the tenancy boundary. `Document` preserves immutable `DocumentVersion` rows, while OCR/extracted fields live in `DocumentMetadata` with confidence and `needsReview` flags. `DocumentShare` stores only a token hash and expiry. `AuditLog` intentionally contains no document content.

Use `npx prisma migrate dev --name init` locally and `npx prisma migrate deploy` in production. Back up PostgreSQL and test restore before handling real documents.
