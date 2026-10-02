# Family onboarding

Phase 1 uses the existing PostgreSQL/Prisma models and database-backed session. No schema migration or second authorization system was added.

## User flow

1. Sign in at `/sign-in`.
2. If the account has no membership, open `/family/create` and create a Family Space. The creator becomes `OWNER`; the server seeds system categories and writes `FAMILY_CREATED`.
3. Use `/family` to switch between memberships and view members, profiles, categories and active invitations.
4. Owners/admins can create copyable invitation links/codes. This phase does not send invitation email and does not pretend that it did.
5. The recipient opens `/join/<token>` or `/join` for the code form, signs in with the targeted email when the invitation specifies one, and accepts once. The server hashes and validates the token/code, checks expiry/revocation/duplicate membership, then creates the membership and audit event transactionally.
6. Owners/admins create and edit profiles at `/profiles` or `/profile/create`. A profile with documents cannot be deleted.
7. Add family categories from the family detail page. System categories seeded during family creation remain available.
8. Open `/documents`; its family/profile/category choices remain the real, authorized data used by the existing PostgreSQL → Appwrite private storage lifecycle.

## Authorization boundaries

- Every family detail, profile and category read checks membership server-side.
- Family settings, invitation management, profile mutations and category creation require `OWNER` or `ADMIN` through the existing `requireFamilyMember` role contract.
- The invite email, link and code are never logged. Only the hashed token/code is stored in PostgreSQL; the raw link/code is returned once to the manager who created it. Both the link token and the human-entered code have 128 bits of randomness.
- Invitation acceptance is one-time, expires after seven days, rejects revoked/used invitations, and rejects an email-targeted invitation when the signed-in email does not match.
- Documents continue to use their existing family authorization and private Appwrite access checks; onboarding does not weaken those routes.

## API summary

See [`docs/api.md`](api.md) for the complete list. The onboarding surface is:

- `GET|POST /api/families`
- `GET|PATCH /api/families/:familyId`
- `GET|POST|DELETE /api/families/:familyId/invite`
- `POST /api/families/invitations/accept`
- `GET|POST /api/profiles`, `PATCH|DELETE /api/profiles/:profileId`
- `GET|POST /api/categories`

The copyable invitation path is intentionally the initial delivery mechanism until a separately authorized invitation-email provider flow is designed and tested.

## Live verification

`scripts/test-onboarding-api.cjs` is an opt-in API smoke test against a local app and the configured PostgreSQL database. It creates synthetic users, exercises family creation, seeded/custom categories, profile CRUD, invitation acceptance, duplicate/revoked invite rejection and non-member isolation, then cleans up its own records. `scripts/test-onboarding.cjs` adds the same flow through a Playwright browser when that optional dependency/browser is available. Neither test sends email or prints OTPs.

```sh
DOCSUP_ONBOARDING_API_TEST=1 DOCSUP_TEST_URL=http://localhost:3000 npm run test:onboarding:api

# Optional browser layer (requires Playwright and a local browser)
DOCSUP_ONBOARDING_TEST=1 DOCSUP_TEST_URL=http://localhost:3000 npm run test:onboarding
```

Use a local app started with the same root `.env`; keep the app and test on the same hostname so the session cookie is available. This test is evidence for onboarding behavior, not proof of Resend inbox delivery.

Recorded checks: the Windows-native app process at a local loopback port and PostgreSQL passed the API smoke test for family creation, seeded/custom categories, profile create/edit/delete, targeted invite acceptance, duplicate/revoked invite rejection and outsider isolation. A Windows Chrome browser smoke test also passed family creation, category creation, profile creation, manager invitation, recipient acceptance/replay rejection, and non-member isolation. The browser test used the existing optional Playwright runtime path; it did not send email.
