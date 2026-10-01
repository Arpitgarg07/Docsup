# Security model

## Tenant isolation

Every document belongs to a family, profile, and uploader. All read/write routes resolve membership on the server. Roles are capabilities, not UI hints. Never trust `familyId`, `documentId`, `profileId`, or role values from the client without a database check.

## Sessions and auth

Sessions are opaque random values in an HttpOnly, SameSite cookie; only a hash is persisted. Sessions expire and can be revoked. OTP challenges store only a hash, have a ten-minute expiry and bounded request attempts. Google OAuth uses a state cookie and server-side code exchange.

## Files

Accept only approved file types, enforce a 25 MB limit, validate magic bytes in the storage adapter, quarantine and scan uploads, use private S3-compatible storage, generate server-side keys, and issue short-lived signed URLs. Never return raw object keys to clients.

## Logging

Do not log document content, images, OTPs, passwords, access tokens, document numbers, or full search queries. Audit events describe the action, actor, family, and non-sensitive metadata.

## Production checklist

- Configure HTTPS, secure cookies, secret manager, CSP, CORS allowlist, and CSRF strategy.
- Add Redis-backed rate limiting and BullMQ workers.
- Add malware scanning/quarantine and magic-byte validation.
- Add backup/restore drills, key rotation, dependency and secret scanning.
- Complete cross-family, IDOR, upload abuse, expired/revoked share, and session tests.
