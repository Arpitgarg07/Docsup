# Storage

Docsup uses **Appwrite Cloud Storage** as its current private object-storage provider. The application does not use AWS S3 and does not return public Appwrite file URLs.

## Runtime architecture

- Next.js route handlers receive authenticated multipart uploads.
- PostgreSQL/Prisma stores the document, immutable `DocumentVersion`, metadata, checksum, approval state, and audit events.
- `apps/web/lib/storage.ts` contains the `StorageProvider` abstraction and the Appwrite server adapter.
- Appwrite stores the file bytes in a private bucket with file-level security, encryption, and antivirus scanning enabled.
- Gemini/Groq processing remains optional and is represented by persisted `AIProcessingJob` records.
- Docker and Redis are optional local/deployment conveniences; neither is required by the storage path.

The `StorageProvider` interface is intentionally kept so a future provider migration can be isolated to one adapter. The current implementation is Appwrite-only; legacy pre-Appwrite versions are marked as `legacy` by migration `0002_appwrite_storage` and are not silently treated as Appwrite files.

## Required server configuration

Set these values in the server environment. Never expose them to browser code or commit them:

```dotenv
APPWRITE_ENDPOINT="https://fra.cloud.appwrite.io/v1"
APPWRITE_PROJECT_ID="6abe8c8c002ba802ef78"
APPWRITE_API_KEY=""
APPWRITE_BUCKET_ID="docsup-private"
SESSION_SECRET=""
```

`APPWRITE_API_KEY` must have only the Appwrite Storage permissions the server needs. `SESSION_SECRET` must be at least 32 characters and is used to sign short-lived application download tokens.

## Bucket setup

After all required environment variables are configured, run:

```bash
npm run storage:setup
```

The setup script is idempotent. It creates the bucket only when it does not exist. If an existing bucket is public or does not have file security enabled, the script stops instead of changing it or using it. It never deletes documents, overwrites files, prints secrets, or creates public URLs.

Do not run this command until the required variables are configured.

## Upload flow

1. The authenticated user must belong to the requested family and cannot be a viewer.
2. The profile and category must belong to that same family.
3. The server enforces the 25 MB limit, an allowlisted MIME type, and file signature/magic-byte validation.
4. The server creates a family/profile/document-scoped object key and uploads bytes with the server-side Appwrite SDK.
5. Prisma records the Appwrite file ID, provider, filename, MIME type, size, and SHA-256 checksum.
6. Approval mode determines whether the document is `APPROVED` or `PENDING_APPROVAL`.
7. Optional AI work is queued without blocking the original upload.

## Download and deletion

Download-token creation requires an authenticated family member and an existing Appwrite file. The token is an HMAC-SHA-256 signed, URL-safe bearer token containing only the file ID and an expiration timestamp; it is limited to five minutes by the route and never exposes an Appwrite URL.

The download endpoint requires the user session again, verifies family membership and document/profile consistency, checks the token expiry and signature, downloads through the private server adapter, verifies the stored byte length and SHA-256 checksum, and records an audit event.

Deletion is restricted to family owners and admins. The database first enters `DELETION_PENDING`, storage versions are removed idempotently, and only then does the document transition to `DELETED` in the same transaction as its audit event. A storage failure leaves the document inaccessible and pending retry, with a security audit event rather than silently claiming deletion.
