# Email OTP authentication (Resend)

## Architecture and contracts

Docsup keeps its existing database-backed OTP verification and opaque session architecture. `/sign-in` now requests **email** codes; SMS is not implemented. Google remains optional; its configuration is unchanged by this integration.

- `POST /api/auth/otp/request` accepts `{ "destination": "you@example.com" }` and normalizes the email to lowercase. Phones/malformed input return 422.
- Only after the email provider accepts the message **and** its challenge is activated does the endpoint return `{ "data": { "sent": true, "expiresIn": <remaining seconds> } }`.
- `sent: true` means accepted for sending, **not proof of inbox delivery**. The UI says so.
- `POST /api/auth/otp/verify` remains unchanged: `{ destination, code }`, six digits, SHA-256 comparison, expiry, five failed attempts, consumed-code protection, existing user lookup/creation and session creation.
- `POST /api/auth/logout` remains unchanged.

`apps/web/lib/email.ts` defines a replaceable `EmailProvider` interface and `ResendEmailProvider`. The adapter calls Resend's **official HTTPS API** (`POST https://api.resend.com/emails`) using Node's built-in `fetch`. The current Resend SDK emits raw provider errors in development; using the official API directly avoids that logging risk without patching the SDK or changing global logging. There is a ten-second timeout, no redirects or automatic retry, and an idempotency key derived from the challenge ID—not the code.

Both email modules use `server-only`. Only a configuration-available boolean reaches the sign-in UI; credentials, OTP hashes and session secrets never do.

## Configure locally — do not paste keys in chat

The agent does **not** edit your real `.env`. Add these values yourself to the root `.env` or server secret environment:

```dotenv
RESEND_API_KEY="<your Resend sending API key>"
AUTH_EMAIL_FROM="Docsup <onboarding@resend.dev>"
```

1. Create a free Resend account at https://resend.com and create an API key with the minimum required sending permission.
2. For a ₹0 local test without buying a domain, use `Docsup <onboarding@resend.dev>` as the sender and request a code **only to the email address associated with your Resend account**.
3. To email other people, verify a domain you control in Resend, add the required DNS records, and change `AUTH_EMAIL_FROM` to e.g. `Docsup <signin@your-verified-domain>`.
4. Restart the local server with the existing root environment loaded. For this workspace, from the root on Windows:

   ```sh
   node -r dotenv/config node_modules/next/dist/bin/next dev apps/web
   ```

   Stop/restart your own previous development instance first rather than running two servers against the same `.next` directory. No Next.js configuration change is needed.
5. Open `http://localhost:3000/sign-in`, enter your permitted recipient email, request a code, and enter the code received in your actual inbox. Do not copy it into chat or logs.
6. Confirm Dashboard → Documents loads using your existing family membership. Authentication does not automatically create a family/profile.

Never use `NEXT_PUBLIC_RESEND_API_KEY`, expose the key in frontend code, or commit `.env`. `.env.example` contains placeholders only. `SESSION_SECRET`, Google credentials, PostgreSQL and Appwrite settings are not changed by this integration.

### ₹0-friendly limits and sender restrictions

Resend currently documents a Free transactional allowance of **100 emails/day and 3,000 emails/month**. Remain on Free; do not enable paid overages or add-ons. The app does not change billing settings, buy a domain or upgrade a plan. Existing account traffic also counts toward the allowance.

The shared `resend.dev` sender is only for your own Resend-account inbox. It is not a free unrestricted sender for every family member. A verified domain is required for other recipients, and obtaining a domain may cost money if you do not already have one.

Sources:
- https://resend.com/docs/send-with-nodejs
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- https://resend.com/docs/knowledge-base/resend-sending-limits
- https://resend.com/pricing

## Safety and limits

- Existing secure six-digit `randomInt` generation and SHA-256 hashing are retained. Code lifetime remains ten minutes from creation; the email includes an absolute UTC expiry and a warning not to share it.
- The original **five requests per normalized email per ten minutes** limit is restored. A short PostgreSQL transaction/advisory lock prevents concurrent requests bypassing that count. No Redis, Docker, SMS or schema changes are required.
- Challenge reservation stores **only the hash**, with `consumedAt` initially set so the unchanged verifier cannot accept an in-flight or failed-send code. Failed sends stay disabled and count toward the quota.
- Provider acceptance is followed by an atomic transaction activating that challenge and consuming prior active codes. The most recently activated accepted request wins; older emails may arrive out of order, so use the latest code or request another after the limit window.
- No database transaction is held open during the external email call. Failed activation never reports success. A provider may accept a message even when a connection fails; any such unactivated code remains unusable.
- Requests do not query whether an account exists and do not reveal account-registration status. Provider error bodies, stack traces, recipients, email contents, OTPs and keys are not logged or returned.
- Errors retain their cause without exposing raw provider content: shared-test-sender recipient restrictions return 403; invalid recipient/request fields return 422; rate/quota exhaustion returns 429; sender/API-key configuration, provider downtime, DNS/network or database failures return 503; provider timeouts return 504. Only unexpected provider responses remain 502.
- `[auth.email.delivery_failed]` logs contain only a correlation request ID, fixed reason category, allowlisted provider error code, upstream HTTP status and application status. No error objects, response bodies, recipient addresses, environment values or OTPs are logged. The request ID also appears in the safe browser error envelope.
- Resend receiving an email and the mailbox retaining it are part of email delivery. Docsup does not persist plaintext OTPs; secure your provider account and avoid unnecessary email tracking. Provider/inbox retention is distinct from the ten-minute verification lifetime.

The per-address limiter is not a global anti-abuse system. Before public production rollout, consider deployment-level request limits and monitoring to stop attackers exhausting the shared free quota across many different addresses.

## Session behavior (unchanged)

`docsup_session` contains an opaque random token; only its SHA-256 hash is stored in PostgreSQL. It is HttpOnly, SameSite=Lax, Path=/, host-only, and lasts up to 30 days. Secure is enabled in production and disabled for local HTTP development. Use HTTPS in production. Server-side validation checks existence/expiry and family membership remains required for Documents. Logout removes the cookie and stored session.

Use the same hostname throughout sign-in and Documents: `localhost` and `127.0.0.1` are different cookie hosts. The dashboard remains a public, explicitly illustrative demo, not evidence of authentication.

## Automated checks versus real delivery

- `npm run test:email`: Node built-in tests with mocked provider HTTP and Prisma. Covers acceptance, hashing, no response/log leakage, validation, missing config, provider rejection/network errors, malformed acceptance, quota preservation, prior-code replacement and database failure.
- `DOCSUP_AUTH_TEST=1 node --conditions=react-server --import tsx scripts/test-email-otp-db.cjs`: opt-in real PostgreSQL reservation/activation and concurrency checks. Resend HTTP is always mocked; no email is sent. Only synthetic challenges are written and cleaned up.
- `scripts/test-auth.cjs`: opt-in browser/backend verification/session tests against a local app **without email configuration**. Requires Playwright (`PLAYWRIGHT_MODULE` can specify its path) and optionally `DOCSUP_BROWSER`. Tests missing configuration, expired/wrong/consumed codes, five-attempt exhaustion, server-issued cookies, session expiry, logout and protected document listing. Synthetic challenges do not prove inbox delivery.

PowerShell uses `$env:DOCSUP_AUTH_TEST="1"` before these opt-in commands. Use the native Windows runtime when PostgreSQL is bound to Windows localhost.

A real email test is separate: configure the variables locally, use your actual permitted inbox, receive the message, and verify the received code in the browser. Automated mock success is **not** a claim that email authentication is working live.

### Results recorded for this integration

- `npm run test:email`: **28 tests passed**, with Resend HTTP and Prisma mocked. Includes regression coverage for the real Resend sandbox-recipient error, API-key/sender/recipient failures, rate limits, timeouts, DNS failures, safe diagnostics and correlation IDs. No mail was sent by these tests.
- Real PostgreSQL integration test: **passed**, including concurrent rate-limit enforcement, hash-only challenge persistence, fail-closed provider failures and prior-code replacement. Provider HTTP was mocked.
- Windows Chrome/backend regression: **passed** for missing email configuration, invalid/wrong/expired/consumed codes, five-attempt exhaustion, successful fixture-based verification, HttpOnly/Secure/SameSite=Lax cookies, protected PostgreSQL listing, session expiry and logout. Synthetic fixtures were cleaned up.
- `npm run typecheck`, `npm run lint`, `npm run build`: **passed** in an isolated Windows copy of the current source, avoiding shared `.next` artifacts.
- Compiled browser-bundle inspection found no Resend environment-variable names or transport endpoint code.
- **Real email delivery and real inbox-code verification: NOT VERIFIED.** A subsequent browser reproduction reached Resend and was rejected as described below. No successful delivery or login is claimed.

### Real 502 diagnosis

The original adapter discarded all non-2xx bodies/statuses and returned a generic 502 for every delivery failure. A real Chrome `/sign-in` reproduction, using the most recent address the user had requested (without displaying it), confirmed:

- The existing local app reported email configuration enabled. An isolated Next.js process running the same code also confirmed `RESEND_API_KEY` and `AUTH_EMAIL_FROM` were present, by booleans only.
- The outgoing request used the configured server key in a Bearer header, JSON content type, the configured sender and a single requested recipient, plus subject/text/HTML.
- Resend was reached and returned **403 / `validation_error`**. The sanitized cause was **shared `resend.dev` sender restricted to the Resend account owner's inbox**.
- The original application converted this into **502**. This was not a DNS/timeout/database or missing-variable failure, and the provider did not report an invalid/expired API key.

The fix preserves a safe classification and now maps this specific restriction to **403**, with a useful frontend explanation. Live retries stopped once the external account restriction was identified. Real request/rate-limit records were not cleared or bypassed.

To resolve the external restriction, either request the OTP to the email associated with the Resend account owning the configured API key, or add/verify your domain in Resend and manually set `AUTH_EMAIL_FROM` to a sender on that verified domain. If the key belongs to a different Resend account than intended, choose the appropriate account/key locally. Never paste the key or OTP into chat. Do not buy a domain or upgrade plans solely for the initial own-inbox test.

After the account/sender/recipient combination is permitted, complete the actual inbox → code entry → session → Documents check. These are implementation/regression results, not production readiness or proof of inbox delivery.
