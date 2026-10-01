# API surface

All JSON responses use `{ data }` on success and `{ error: { message, requestId } }` on failure. State-changing routes require an authenticated session.

- `GET /api/health`
- `GET|POST /api/families`
- `POST /api/families/:familyId/invite`
- `GET /api/documents?familyId=...&q=...`
- `GET|DELETE /api/documents/:documentId`
- `POST /api/documents/:documentId/approve`
- `POST /api/documents/:documentId/process`
- `POST /api/documents/:documentId/share`
- `GET /api/search?familyId=...&q=...`
- `GET /api/audit?familyId=...`
- `POST /api/auth/otp/request`
- `GET /api/auth/google`, `GET /api/auth/google/callback`
- `POST /api/auth/logout`

Uploads currently use `POST /api/documents` with an authenticated multipart request. The server validates the family, profile, category, MIME type, magic bytes, and 25 MB limit before writing to the Appwrite private bucket. It then records an immutable `DocumentVersion`, applies the family approval mode, writes an audit event, and optionally queues an AI processing job. Download-token creation and streaming are authenticated and never expose a public Appwrite URL.
