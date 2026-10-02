# Docsup feature matrix (repository audit)

Audit basis: current `master` working tree, Prisma schema/migrations, Next.js routes, components, API handlers, and existing synthetic/live verification scripts. Statuses describe the current repository, not a future plan.

| Feature | Status | Evidence / boundary |
| --- | --- | --- |
| PostgreSQL/Prisma foundation | COMPLETE + VERIFIED | Applied `0001_init` and `0002_appwrite_storage`; Prisma client and live queries pass. |
| Appwrite private storage | COMPLETE + VERIFIED | Private `docsup-private` bucket, `StorageProvider`, upload/download/delete lifecycle and cleanup verified with synthetic PDF. |
| Email OTP/session auth | COMPLETE + VERIFIED | Existing verifier/session cookie tests pass; Resend account-owner delivery was reported verified by the user. Shared `resend.dev` remains development-only. |
| Google OAuth | PARTIAL | Routes exist; credentials are optional and not configured as an MVP requirement. |
| Dashboard | PARTIAL | Existing dashboard is an illustrative demo; real Documents link works, hardcoded statistics remain labeled illustrative. |
| Family list/create API | COMPLETE + API VERIFIED | `GET|POST /api/families` creates owner membership and default categories; live synthetic API flow passed. |
| Family list/create UI | COMPLETE + BROWSER VERIFIED | `/family` and `/family/create` are real session-backed pages; Windows Chrome live smoke test passed. |
| Family detail/member list | COMPLETE + API VERIFIED | Membership-scoped detail route and `/family/[familyId]` view expose real members, profiles, categories and manager-only invites. |
| Family invitations | COMPLETE + API VERIFIED | Manager-only list/create/revoke plus one-time token/code acceptance; live tests cover targeted recipient, duplicate, revoked and outsider rejection. No invitation email is claimed. |
| Profiles | COMPLETE + API VERIFIED | Owner/admin CRUD routes and `/profiles`/`/profile/create`; profiles with documents cannot be deleted. |
| Categories | COMPLETE + API VERIFIED | Member list and owner/admin create route/UI; duplicate slug/name conflicts return 409. |
| Documents backend/frontend | COMPLETE + VERIFIED | `/documents`, upload/list/detail/approve/download/delete and security checks are live verified; onboarding supplies its real family/profile/category choices. |
| Search | COMPLETE + VERIFIED | `/api/search/documents` and compatibility `/api/search` support family-scoped q, filename, metadata, profile/category, status, verification, dates and bounded pagination; integrated into `/documents`. API and real-browser document lifecycle tests pass. |
| Sharing | PARTIAL | Share creation endpoint/model exists; no share access/revoke/list UI or complete public route. |
| Audit | IMPLEMENTED BUT UNVERIFIED | Family-scoped admin API exists; no audit UI. |
| Notifications | MISSING | Prisma model exists; no API/UI. |
| AI gateway | IMPLEMENTED BUT UNVERIFIED | Gemini/Groq abstraction and metadata-processing endpoint exist; no production OCR/classification UI or live provider verification. |
| Image enhancement/conversion | MISSING | No implementation. |
| Android | MISSING / PLACEHOLDER | `apps/mobile/README.md` only; no client implementation. |
| CSP/CORS hardening | PARTIAL | Security headers exist; CSP/CORS strategy requires a dedicated review before production. |
| Automated quality checks | COMPLETE + VERIFIED | `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:email`, live search/onboarding API smoke tests, Windows Chrome onboarding smoke test and existing live document/Appwrite lifecycle pass. |

## Phase 1 scope for this change

Implemented the smallest real onboarding slice using the existing schema and session:

- authenticated family list/create and family detail/member/category views;
- owner/admin invitation creation, listing, revocation and secure token/code acceptance;
- family-scoped profile list/create/edit/delete-when-unused;
- category list/create for owner/admin;
- `/documents` family selector consumes the same authorized family/profile/category data;
- no invitation email, fake member, fake profile, or fake success state.

No Prisma migration was needed because the existing models contain the required fields.
