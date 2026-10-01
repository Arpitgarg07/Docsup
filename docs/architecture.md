# Architecture

Docsup is a modular monolith first:

- **Next.js** serves the web surface and REST route handlers.
- **PostgreSQL/Prisma** owns tenant-scoped domain data, immutable document versions, approval state, AI jobs, and audit logs.
- **Appwrite Cloud Storage** stores document bytes in a private bucket through the server-only `StorageProvider` adapter.
- **Gemini/Groq** are optional server-side AI providers; AI output is untrusted and does not block the core vault.
- Docker and Redis are optional infrastructure, not mandatory application dependencies.

The `StorageProvider` interface in `apps/web/lib/storage.ts` isolates provider operations so a future storage migration does not change route authorization or the database contract. Appwrite is the current provider; the application does not use AWS S3 and does not expose public Appwrite file URLs.

## Request path

1. An opaque session cookie identifies a user; only its SHA-256 hash is stored.
2. Route handlers validate request bodies, query parameters, and multipart upload metadata with Zod.
3. Access checks resolve `FamilyMember` from the authenticated user and requested family.
4. Uploads verify that profile and category IDs belong to the same family.
5. Prisma queries include the family predicate; client-supplied IDs are never treated as authorization.
6. The upload validator enforces a 25 MB limit, allowlisted MIME types, and file signatures before Appwrite receives bytes.
7. The server uploads to the private Appwrite bucket and records the Appwrite file ID, provider, immutable version metadata, and SHA-256 checksum in PostgreSQL.
8. Approval mode determines whether the document is immediately approved or remains pending. Optional AI processing is represented by persisted `AIProcessingJob` records so a worker can be added later.
9. Download-token creation and download streaming both require an authenticated family member. The streaming route verifies the short-lived HMAC token, storage existence, byte length, checksum, and profile-family consistency before returning bytes.
10. Deletion enters `DELETION_PENDING`, removes all Appwrite versions idempotently, and transitions to `DELETED` only after auditable database completion.

The mobile client consumes the same REST contract. It must use encrypted secure storage and should cache only non-sensitive metadata by default.
