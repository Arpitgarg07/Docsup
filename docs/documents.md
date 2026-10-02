# Documents frontend

## Scope

`/documents` is a real, session-authenticated document workspace. The dashboard retains illustrative statistics; its Documents, View all, and Upload links lead to the real workspace. Family and Profiles onboarding now provide real membership-scoped setup; Search, Notifications, Security and Settings remain disabled.

The Documents server component calls the existing `getCurrentUser()` and loads only that user's `FamilyMember` records, selecting family/profile/category IDs and names. The browser workspace uses those authorized choices and the existing REST APIs; it does not create fallback demo choices. Family/profile/category mutations are implemented separately under `/family` and `/profiles` and use the same session and membership authority.

## Existing contracts used

JSON success responses are `{ data: ... }`; API failures are `{ error: { message, requestId } }`. Requests retain the same-origin session cookie and use `no-store`.

| Operation | Existing API | Input / output consumed |
| --- | --- | --- |
| List | `GET /api/documents?familyId=...&page=...&pageSize=20` | Returns `items`, `page`, `pageSize`, `total`, `pages`. Items include title, family, profile/category names, type/status, dates, verification fields and latest version MIME/size. |
| Upload | `POST /api/documents` | Multipart `familyId`, `profileId`, `categoryId`, `title`, `documentType`, `file`, string `sensitive=true/false`, `enhanceWithAI=false`. Returns `{ id, status, processingQueued }`, HTTP 201 only after backend completion. |
| Details | `GET /api/documents/:documentId` | Returns document fields, profile, category, metadata and version summaries. This screen shows metadata and versions, not an inline file preview. |
| Approval | `POST /api/documents/:documentId/approve` | JSON `{ action: "approve" }`; returns the updated document. Owners/admins only. The existing API also supports `reject`, `verify` and an optional `note`; these are not added as new UI flows here. |
| Secure access | `POST /api/documents/:documentId/download` | Returns `{ url, expiresAt }`. Only APPROVED, VERIFIED or ARCHIVED documents are downloadable under the existing backend policy. |
| Download bytes | `GET /api/storage/access?token=...` | Redeems the signed URL with the authenticated cookie; returns file bytes or an API error. The browser never uses a public Appwrite URL. |
| Delete | `DELETE /api/documents/:documentId` | Owners/admins only. Returns `{ deleted: true }` after storage cleanup and database soft deletion. |

Search was inspected: `GET /api/search?familyId=...&q=...` requires a 2–120 character query and returns `{ items }`; document listing also supports `q`, `status`, `profileId`, `categoryId`. A Search module is intentionally not implemented in this change.

## UI behavior and limitations

- Loading, empty, signed-out, missing-family, missing-upload-choice and API-error states are explicit.
- Uploads validate through the existing backend. A viewer cannot upload. Missing profiles/categories block upload rather than creating demo choices.
- A successful upload resets the form, loads details and refreshes page one so the new document is visible. If refresh fails, that error is displayed separately from the confirmed upload.
- Pending documents show their real status; an owner/admin can approve them before download.
- Download first requests a token, then fetches the same-origin byte endpoint. API errors are displayed rather than saved as files. A temporary browser blob URL is used only to hand authenticated bytes to the browser's download manager.
- Deletion requires confirmation. Cancel changes nothing. Errors do not claim success; an uncertain deletion blocks approval/download until retried or reconciled.
- Family changes reset the document workspace. Aborted/stale list and detail requests cannot replace another family's results. The backend remains the authority for every operation.
- An existing signed-in session, family membership, profile and category are prerequisites. Use `/family` to create/manage a family, `/profiles` to create/edit profiles, and the family detail page to add categories. The `/sign-in` UI supports server-side Resend email OTP; configure the provider and verify real inbox delivery before relying on end-user login. See [authentication setup and status](authentication.md). AI jobs and search UI remain outside the Documents flow.

## Opt-in live regression check

`scripts/test-documents.cjs` runs a browser-driven synthetic PDF lifecycle against a local app using the real PostgreSQL and Appwrite services. It creates isolated families/users/profiles/categories and synthetic OTP challenges, exercises the **existing** OTP verification/session endpoint, and cleans up only its own fixtures. It does not test OTP delivery or user onboarding.

Prerequisites: Playwright available to the test runner (or `PLAYWRIGHT_MODULE` set to its module path), a browser (`DOCSUP_BROWSER` optionally supplies an executable), the existing root `.env`, and a local app process loaded with that same configuration. Do not point it at another database or storage account accidentally. Secrets are not printed.

```sh
# Start the app with the already configured root environment loaded.
# Use the native Windows runtime when PostgreSQL is bound to Windows localhost.
node -r dotenv/config node_modules/next/dist/bin/next start apps/web --port 3107

# In another terminal; requires the optional browser tooling described above:
DOCSUP_LIVE_TEST=1 DOCSUP_TEST_URL=http://localhost:3107 node scripts/test-documents.cjs
```

Windows PowerShell uses `$env:DOCSUP_LIVE_TEST="1"` and `$env:DOCSUP_TEST_URL="http://localhost:3107"` before invoking the script. Do not run development and production servers against the same `.next` directory simultaneously; use an isolated copy if an existing dev server must remain running.

The successful lifecycle is not mocked. One separately labeled negative check injects a list-network error to verify retry behavior. The script also checks real signature rejection, approval gating, direct anonymous storage denial, family isolation, viewer restrictions, token tampering, cancel/delete, storage cleanup, soft deletion, audit logging and signed-out UI.

## Verification recorded for this implementation

- `npm run typecheck`, `npm run lint`, `npm run build`: passed. The final source was also checked with those exact npm scripts in an isolated same-drive Windows copy, avoiding interference with the already-running development server's `.next` output.
- Browser-driven live test: **passed** using Windows Chrome and the existing PostgreSQL/Appwrite configuration on an isolated local server at `http://127.0.0.1:3107`.
- A generated 615-byte synthetic PDF was uploaded through the UI/API. Its Appwrite bytes, private permissions, PostgreSQL version/size/SHA-256, list visibility and detail fields were verified. The original upload remained pending until the UI approval action succeeded.
- The application download returned identical bytes through the signed, authenticated application endpoint. No browser request went to Appwrite; a separate anonymous direct-access attempt was denied.
- UI deletion removed the Appwrite object, produced `DELETED` and a deletion audit record, refreshed to an empty list, and invalidated the previous download link. Those states were asserted **before** synthetic fixture cleanup.
- Authenticated cross-family list/detail/token/delete requests and a cross-family profile upload were denied. Viewer restrictions, token tampering, safe authorized reuse, signed-out UI, list error/retry and deletion cancellation were checked.
- Desktop/mobile screenshots were inspected; the mobile workspace had no horizontal overflow.
- Synthetic files, users, OTP/session records and family data were cleaned up. The temporary test server was stopped; the user's existing development server was left running.

This is not a production-readiness claim. The live file fixture was a PDF; other formats, large-file stress and interrupted storage failures were not validated by this run. Onboarding API/UI checks are tracked separately from the document lifecycle check.
