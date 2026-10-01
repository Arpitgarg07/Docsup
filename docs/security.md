# Security model

## Tenant isolation

Every document belongs to a family, profile, and uploader. Read, upload, download-token, download, share, approval, processing, and delete routes resolve membership on the server. Roles are capabilities, not UI hints. Never trust `familyId`, `documentId`, `profileId`, or role values from the client without a database check.

Document uploads also verify that the selected profile and category belong to the requested family. Download responses re-check the document's family membership and profile-family consistency instead of trusting a token alone.

## Sessions and auth

Sessions are opaque random values in an HttpOnly, SameSite cookie; only a hash is persisted. Sessions expire and can be revoked. OTP challenges store only a hash, have a ten-minute expiry and bounded request attempts. Google OAuth uses a state cookie and server-side code exchange.

## Private files

Docsup uses Appwrite Cloud Storage through the server-side `StorageProvider` abstraction. The configured bucket must be private, with Appwrite file security enabled. `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, and `APPWRITE_BUCKET_ID` are server-only environment variables; the API key is never sent to the browser.

The upload path:

- limits files to 25 MB;
- allowlists PDF, JPEG, PNG, WebP, DOC, and DOCX MIME types;
- validates magic bytes/signatures instead of trusting a filename or browser MIME value;
- generates server-side family/profile/document object keys;
- records a SHA-256 checksum in `DocumentVersion`;
- stores bytes only in the private Appwrite bucket; and
- never returns a public Appwrite file URL.

Downloads require an authenticated family member. The application issues a short-lived HMAC-SHA-256 token and checks its expiration, signature, document status, family membership, storage existence, byte length, and checksum before streaming the file. Tokens are bearer capabilities during their short lifetime, so they are not logged or persisted. Reusing an unexpired token does not bypass the session and family checks.

Deletion is restricted to owners and admins. Storage cleanup is idempotent. Documents enter `DELETION_PENDING` before external cleanup and become `DELETED` only after all versions are removed and the database audit transaction succeeds. Failures remain inaccessible and produce a `DOCUMENT_DELETION_FAILED` security audit event for retry/reconciliation.

## Logging

Do not log document content, images, OTPs, passwords, access tokens, document numbers, or full search queries. Audit events describe the action, actor, family, and non-sensitive metadata. Setup scripts must not print API keys or create public URLs.

## Optional infrastructure

PostgreSQL is required. Docker is an optional way to run local dependencies. Redis and a queue worker are optional for the MVP; persisted AI jobs can be added to a worker later without changing storage authorization.

## Production checklist

- Configure HTTPS, secure cookies, secret manager, CSP, CORS allowlist, and CSRF strategy.
- Configure Appwrite Cloud private bucket settings and rotate the server API key through managed secrets.
- Add Redis-backed rate limiting and BullMQ workers when queue scale requires it.
- Verify malware scanning/quarantine and magic-byte validation with synthetic fixtures.
- Add backup/restore drills, key rotation, dependency and secret scanning.
- Complete cross-family, IDOR, upload abuse, expired/revoked share, deletion-reconciliation, and session tests.
- Use only synthetic/demo files in development and integration testing.
