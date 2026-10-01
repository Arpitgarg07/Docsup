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

The upload completion contract should be added alongside the private object-storage adapter: request an authorized presigned upload, upload directly, then complete into `DocumentVersion` and enqueue scanning/processing.
