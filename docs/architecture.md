# Architecture

Docsup is a modular monolith first: Next.js serves the web surface and REST boundary, Prisma owns PostgreSQL access, and background work is represented by persisted `AIProcessingJob` records so a BullMQ worker can be added without changing the domain API.

## Request path

1. An opaque session cookie identifies a user; only its SHA-256 hash is stored.
2. Route handlers validate request bodies/query parameters with Zod.
3. Access checks resolve `FamilyMember` from the authenticated user and requested family.
4. Prisma queries include the family predicate; client-supplied IDs are never treated as authorization.
5. Security-sensitive actions append an `AuditLog` without document contents.
6. Files use server-generated object keys and private object storage. Downloads should be short-lived signed URLs.

The mobile client consumes the same REST contract. It must use encrypted secure storage and should cache only non-sensitive metadata by default.
