// Opt-in verification/session regression checks, NOT proof of real email delivery.
// Requires the app to run WITHOUT email configuration for its missing-config test.
// Synthetic challenges then exercise the unchanged verification/session backend.
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomInt, createHash } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
assert.equal(process.env.DOCSUP_AUTH_TEST, '1', 'Set DOCSUP_AUTH_TEST=1 to allow synthetic auth fixtures');
assert.ok(!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM, 'Do not run the missing-config test with real email configuration; it must not send test mail');
const { PrismaClient } = require('@prisma/client');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DOCSUP_TEST_URL || 'http://localhost:3108';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local test app required');
const db = new PrismaClient();
const destination = `docsup-auth-${randomUUID()}@example.invalid`;
let userId;
let familyId;
let browser;

async function main() {
  browser = await chromium.launch({ headless: true, ...(process.env.DOCSUP_BROWSER ? { executablePath: process.env.DOCSUP_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.goto(base + '/documents');
  await page.getByRole('alert').filter({ hasText: 'Sign in required' }).waitFor();
  assert.equal((await context.request.get(base + '/api/documents?familyId=unauthorized')).status(), 401);
  await page.getByRole('link', { name: 'Sign in to Docsup', exact: true }).click();
  await page.waitForURL(base + '/sign-in');
  assert.equal(await page.getByRole('link', { name: 'Continue with Google' }).count(), process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? 1 : 0, 'Google availability should reflect existing server configuration; this test never uses Google');
  await page.getByLabel('Email address').fill(destination);
  const requestResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/otp/request');
  await page.getByRole('button', { name: 'Request code', exact: true }).click();
  assert.equal((await requestResponse).status(), 503);
  await page.getByRole('alert').filter({ hasText: 'No sign-in code was sent' }).waitFor();
  assert.equal(await db.otpChallenge.count({ where: { destination } }), 0);
  assert.equal((await context.cookies()).some(cookie => cookie.name === 'docsup_session'), false);
  await page.getByLabel('Six-digit code').fill('000000');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await page.getByRole('alert').filter({ hasText: 'Code expired or unavailable' }).waitFor();
  assert.equal(page.url(), base + '/sign-in');
  console.log('PASS normal-browser blocker: no provider -> 503, no challenge/cookie, invalid code cannot authenticate');
  console.log('NORMAL BROWSER OTP DELIVERY/LOGIN: BLOCKED (not passed)');

  // Regression fixture only: this is NOT sent through an external provider and
  // is never returned by an application endpoint or displayed as a local bypass.
  const user = await db.user.create({ data: { email: destination, name: 'Synthetic auth test' } });
  userId = user.id;
  const family = await db.family.create({ data: { name: 'Synthetic auth test family', members: { create: { userId, role: 'OWNER' } } } });
  familyId = family.id;
  const expiredCode = String(randomInt(100000, 999999));
  await db.otpChallenge.create({ data: { destination, userId, codeHash: createHash('sha256').update(expiredCode).digest('hex'), expiresAt: new Date(Date.now() - 60_000) } });
  const expired = await context.request.post(base + '/api/auth/otp/verify', { data: { destination, code: expiredCode } });
  assert.equal(expired.status(), 401);

  const limitedCode = String(randomInt(100000, 999999));
  const limited = await db.otpChallenge.create({ data: { destination, userId, codeHash: createHash('sha256').update(limitedCode).digest('hex'), expiresAt: new Date(Date.now() + 300_000) } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const wrong = await context.request.post(base + '/api/auth/otp/verify', { data: { destination, code: '000000' } });
    assert.equal(wrong.status(), 401);
  }
  assert.equal((await db.otpChallenge.findUniqueOrThrow({ where: { id: limited.id } })).attempts, 5);
  assert.equal((await context.request.post(base + '/api/auth/otp/verify', { data: { destination, code: limitedCode } })).status(), 401);
  assert.equal(await db.session.count({ where: { userId } }), 0);
  console.log('PASS expired OTP, wrong OTP and five-attempt limit; even a correct code is rejected after exhaustion');

  const code = String(randomInt(100000, 999999));
  const challenge = await db.otpChallenge.create({ data: { destination, userId, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt: new Date(Date.now() + 300_000) } });
  await page.getByLabel('Six-digit code').fill(code);
  const verifyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/otp/verify');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  assert.equal((await verifyResponse).status(), 200);
  await page.waitForURL(base + '/dashboard');
  const cookie = (await context.cookies()).find(item => item.name === 'docsup_session');
  assert.ok(cookie);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.path, '/');
  assert.equal(cookie.secure, true, 'This regression run expects a production server');
  assert.ok(cookie.expires > Date.now() / 1000);
  assert.equal(await page.evaluate(() => document.cookie.includes('docsup_session')), false);
  const session = await db.session.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(cookie.value).digest('hex') } });
  assert.equal(session.userId, userId);
  assert.ok(session.tokenHash !== cookie.value, 'The raw session token must not be persisted');
  assert.ok((await db.otpChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).consumedAt);
  console.log('PASS fixture-only verification: backend issued HttpOnly/Secure/SameSite=Lax cookie; only token hash persisted');

  const listResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/documents' && response.request().method() === 'GET');
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.waitForURL(base + '/documents');
  const listed = await listResponse;
  assert.equal(listed.status(), 200);
  assert.equal(new URL(listed.url()).searchParams.get('familyId'), familyId);
  assert.deepEqual((await listed.json()).data.items, []);
  await page.getByRole('heading', { name: 'No documents yet' }).waitFor();
  assert.equal((await db.session.findUniqueOrThrow({ where: { id: session.id } })).userId, userId);
  assert.equal((await page.evaluate(async () => (await fetch('/api/documents?familyId=unrelated-family')).status)), 404);
  console.log('PASS fixture-only Sign in -> Dashboard -> Documents: real PostgreSQL empty list and server authorization');

  // Previously consumed OTP must not issue another authenticated session.
  const replay = await context.request.post(base + '/api/auth/otp/verify', { data: { destination, code } });
  assert.equal(replay.status(), 401);
  await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'Sign in required' }).waitFor();
  assert.equal(await page.evaluate(async () => (await fetch('/api/documents?familyId=unrelated-family')).status), 401);
  assert.equal(await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status), 200);
  assert.equal((await context.cookies()).some(item => item.name === 'docsup_session'), false);
  assert.equal(await db.session.count({ where: { userId } }), 0);
  console.log('PASS consumed-code rejection, expired-session denial and logout cookie/DB revocation');
  console.log('AUTH BACKEND/UI REGRESSION: PASS; normal OTP delivery remains BLOCKED');
}

main().catch(error => {
  // Never print API payloads, OTP values, cookie values or connection strings.
  let message = String(error.message);
  for (const name of ['DATABASE_URL', 'SESSION_SECRET']) if (process.env[name]) message = message.split(process.env[name]).join('[REDACTED]');
  console.error('FAIL:', message);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  try {
    await db.otpChallenge.deleteMany({ where: { destination } });
    if (familyId) await db.family.delete({ where: { id: familyId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    console.log('Synthetic authentication fixtures cleaned up');
  } finally { await db.$disconnect(); }
});
