# API surface

All JSON responses use `{ data }` on success and `{ error: { message, requestId } }` on failure. State-changing routes require an authenticated session.

- `GET /api/health`
- `GET|POST /api/families`
- `GET|PATCH /api/families/:familyId`
- `GET|POST|DELETE /api/families/:familyId/invite`
- `POST /api/families/invitations/accept`
- `GET|POST /api/profiles`, `PATCH|DELETE /api/profiles/:profileId`
- `GET|POST /api/categories`
- `GET /api/documents?familyId=...&q=...`
- `GET|DELETE /api/documents/:documentId`
- `POST /api/documents/:documentId/approve`
- `POST /api/documents/:documentId/process`
- `POST /api/documents/:documentId/share`
- `GET /api/search/documents?familyId=...&q=...` (text, profile/category, status, verification, dates, bounded pagination)
- `GET /api/search?familyId=...&q=...` (compatibility route using the same search contract)
- `GET /api/audit?familyId=...`
- `POST /api/auth/otp/request`
- `GET /api/auth/google`, `GET /api/auth/google/callback`
- `POST /api/auth/logout`

Family and profile management routes enforce the current session and family membership on the server. Owner/admin-only mutations include family settings, invitation management, profile CRUD and category creation. Invitation acceptance accepts a hashed one-time link token or code, checks expiry/revocation/email targeting/duplicate membership, and creates the membership transactionally. The initial invitation flow intentionally returns a copyable secure link/code and does not claim to send email.

Uploads currently use `POST /api/documents` with an authenticated multipart request. The server validates the family, profile, category, MIME type, magic bytes, and 25 MB limit before writing to the Appwrite private bucket. It then records an immutable `DocumentVersion`, applies the family approval mode, writes an audit event, and optionally queues an AI processing job. Download-token creation and streaming are authenticated and never expose a public Appwrite URL.
