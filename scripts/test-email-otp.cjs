// No real network, credentials, mailboxes or database are used by these unit
// tests. Provider HTTP and Prisma are the only mocked boundaries.
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { db } = require('../apps/web/lib/db.ts');
const { POST } = require('../apps/web/app/api/auth/otp/request/route.ts');
const { ResendEmailProvider, EmailDeliveryError, isEmailConfigured } = require('../apps/web/lib/email.ts');

const originalTransaction = db.$transaction;
const initialEnvironment = { RESEND_API_KEY: process.env.RESEND_API_KEY, AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM };
let rows, logs, tx, captured, locks;
const destination = 'synthetic@example.invalid';
const request = (value = destination) => new Request('http://localhost/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ destination: value }), headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_synthetic_not_a_real_key';
  process.env.AUTH_EMAIL_FROM = 'Docsup <signin@example.invalid>';
  rows = []; logs = []; captured = []; locks = 0;
  for (const name of ['log', 'warn', 'error', 'info', 'debug']) mock.method(console, name, (...args) => logs.push(args));
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const message = JSON.parse(options.body);
    captured.push(message);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.headers['Idempotency-Key'].startsWith('docsup-otp-'));
    assert.ok(rows.at(-1).consumedAt, 'Pending code must be unverifiable before provider accepts');
    return new Response(JSON.stringify({ id: 'synthetic-mail-id' }), { status: 200 });
  });
  tx = {
    $executeRaw: async () => { locks++; return 1; },
    otpChallenge: {
      count: async ({ where }) => rows.filter(row => row.destination === where.destination && row.createdAt > where.createdAt.gt).length,
      create: async ({ data }) => {
        const row = { ...data, id: randomUUID(), createdAt: new Date(), attempts: 0 };
        rows.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of rows) if (row.destination === where.destination && row.consumedAt === null) { Object.assign(row, data); count++; }
        return { count };
      },
      update: async ({ where, data }) => Object.assign(rows.find(row => row.id === where.id), data),
    },
  };
  // Prisma exposes methods through a proxy; direct replacement avoids node:test
  // inspecting a non-value property descriptor. Restored after every case.
  db.$transaction = async callback => callback(tx);
});

afterEach(() => {
  const diagnosticLogs = logs;
  const fakeKey = process.env.RESEND_API_KEY;
  mock.restoreAll();
  db.$transaction = originalTransaction;
  for (const [name, value] of Object.entries(initialEnvironment)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  for (const entry of diagnosticLogs) {
    assert.equal(entry.length, 2);
    assert.equal(entry[0], '[auth.email.delivery_failed]');
    const event = entry[1];
    assert.ok(Object.keys(event).sort().join(',') === 'applicationStatus,provider,providerCode,reason,requestId,upstreamStatus');
    assert.ok(/^[0-9a-f-]{36}$/.test(event.requestId));
    assert.equal(event.provider, 'resend');
    assert.ok(/^[a-z_]+$/.test(event.reason) && /^[a-z_]+$/.test(event.providerCode));
    assert.ok(event.upstreamStatus === null || Number.isInteger(event.upstreamStatus));
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes(destination) && (!fakeKey || !serialized.includes(fakeKey)), 'Diagnostics must not contain recipients or credentials');
    for (const mail of captured) {
      const otp = mail.text.match(/code is: (\d{6})/)[1];
      assert.ok(!serialized.includes(otp), 'Diagnostics must not contain OTPs');
    }
  }
});

test('valid email -> secure hashed challenge -> official API acceptance -> success, without leakage', async () => {
  const response = await POST(request(' Synthetic@Example.Invalid '));
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.equal(payload.data.sent, true);
  assert.ok(payload.data.expiresIn > 0 && payload.data.expiresIn <= 600);
  assert.equal(captured.length, 1);
  const mail = captured[0];
  const code = mail.text.match(/code is: (\d{6})/)[1];
  assert.ok(/^[1-9]\d{5}$/.test(code));
  assert.deepEqual(mail.to, [destination]);
  assert.equal(mail.from, process.env.AUTH_EMAIL_FROM);
  assert.equal(mail.subject, 'Your Docsup sign-in code');
  assert.ok(mail.html.includes(code) && mail.text.includes('10 minutes') && mail.text.includes('Do not share'));
  assert.equal(rows[0].destination, destination);
  assert.ok(rows[0].codeHash === createHash('sha256').update(code).digest('hex'));
  assert.equal(rows[0].consumedAt, null);
  assert.ok(rows[0].expiresAt - rows[0].createdAt <= 600_000 && rows[0].expiresAt - rows[0].createdAt > 590_000);
  assert.ok(!JSON.stringify(rows).includes(code), 'Only the hash may persist');
  assert.ok(!text.includes(code) && !text.includes(process.env.RESEND_API_KEY) && !text.includes(destination));
  assert.equal(locks, 2);
});

test('invalid email, phone and malformed JSON are rejected before any provider or database operation', async () => {
  for (const value of ['invalid', '+919999999999', '', 'a\r\nb@example.invalid']) assert.equal((await POST(request(value))).status, 422);
  assert.equal((await POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status, 422);
  assert.equal(rows.length, 0);
  assert.equal(captured.length, 0);
  assert.equal(locks, 0);
});

test('missing configuration fails safely with no challenge or false success', async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal(isEmailConfigured(), false);
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(rows.length, 0);
  assert.equal(captured.length, 0);
  assert.ok(!(await response.text()).includes('sent":true'));
});

test('malformed sender configuration is not sent to the provider', async () => {
  process.env.AUTH_EMAIL_FROM = 'bad\r\nheader@example.invalid';
  assert.equal((await POST(request())).status, 503);
  assert.equal(rows.length, 0);
});

test('provider rejection with reflected secrets is sanitized; challenge stays disabled', async () => {
  mock.method(globalThis, 'fetch', async (_url, options) => new Response(JSON.stringify({ message: options.body + options.headers.Authorization }), { status: 403 }));
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.ok(rows[0].consumedAt);
  const payload = await response.json();
  assert.equal(payload.error.message, 'Email sending is not authorized. Ask the administrator to check the sender and Resend account permissions.');
  assert.ok(!JSON.stringify(payload).includes(process.env.RESEND_API_KEY));
});

test('network rejection is sanitized and leaves the hash unusable', async () => {
  mock.method(globalThis, 'fetch', async (_url, options) => { throw new Error(options.body + options.headers.Authorization); });
  assert.equal((await POST(request())).status, 503);
  assert.ok(rows[0].consumedAt);
});

test('malformed successful provider response does not count as accepted delivery', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  assert.equal((await POST(request())).status, 502);
  assert.ok(rows[0].consumedAt);
});

test('the sixth request within ten minutes is denied; historical five-request limit is preserved', async () => {
  for (let index = 0; index < 5; index++) assert.equal((await POST(request())).status, 200);
  assert.equal((await POST(request())).status, 429);
  assert.equal(captured.length, 5);
  assert.equal(rows.filter(row => row.consumedAt === null).length, 1, 'Only the latest accepted code remains usable');
  rows.forEach(row => { row.createdAt = new Date(Date.now() - 601_000); });
  assert.equal((await POST(request())).status, 200);
});

test('provider failures also count toward the quota and never enable an OTP', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }));
  for (let index = 0; index < 5; index++) assert.equal((await POST(request())).status, 429);
  assert.equal((await POST(request())).status, 429);
  assert.equal(rows.filter(row => row.consumedAt === null).length, 0);
});

test('database reservation failure does not send or expose internal errors', async () => {
  db.$transaction = async () => { throw new Error('Synthetic internal database details'); };
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(captured.length, 0);
  assert.ok(!(await response.text()).includes('Synthetic internal'));
});

test('accepted email with failed activation never returns success; pending code stays unusable', async () => {
  let calls = 0;
  db.$transaction = async callback => {
    if (++calls === 2) throw new Error('Synthetic transaction failure');
    return callback(tx);
  };
  assert.equal((await POST(request())).status, 503);
  assert.equal(captured.length, 1);
  assert.ok(rows[0].consumedAt);
});

test('Resend provider never passes through raw exceptions', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('Synthetic sensitive exception'); });
  const provider = new ResendEmailProvider('synthetic-key', 'Docsup <a@example.invalid>');
  await assert.rejects(provider.send({ to: destination, subject: 'Synthetic test', text: 'synthetic', html: '<p>synthetic</p>', idempotencyKey: 'synthetic-id' }), error => error instanceof EmailDeliveryError && !error.message.includes('sensitive'));
});

const providerCases = [
  [403, 'validation_error', 'You can only send testing emails to your own email address (owner@example.invalid). To send emails to other recipients, please verify a domain.', 403, 'test_recipient_restricted'],
  [403, 'validation_error', 'The example.invalid domain is not verified. Please add and verify your domain.', 503, 'sender_not_verified'],
  [403, 'validation_error', 'API key is invalid', 503, 'credentials_rejected'],
  [403, 'restricted_api_key', 'API key is not active', 503, 'credentials_rejected'],
  [403, 'suspended_api_key', 'This API key is suspended', 503, 'credentials_rejected'],
  [403, 'invalid_permission', 'Access token is missing required scopes', 503, 'credentials_rejected'],
  [401, 'missing_api_key', 'Missing API key in the authorization header', 503, 'credentials_rejected'],
  [429, 'rate_limit_exceeded', 'Too many requests', 429, 'provider_limited'],
  [429, 'daily_quota_exceeded', 'Daily quota exceeded', 429, 'provider_limited'],
  [500, 'application_error', 'Internal server error', 503, 'provider_unavailable'],
  [400, 'validation_error', 'Invalid `from` field.', 503, 'sender_not_verified'],
  [422, 'validation_error', 'Invalid `to` field.', 422, 'recipient_invalid'],
  [422, 'missing_required_field', 'Missing body field', 422, 'request_invalid'],
];
for (const [upstream, name, message, expected, reason] of providerCases) {
  test(`provider ${upstream}/${name}/${reason} maps to safe application ${expected}`, async () => {
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ name, message }), { status: upstream }));
    const response = await POST(request());
    assert.equal(response.status, expected);
    const body = await response.json();
    assert.ok(rows[0].consumedAt, 'Delivery failure must leave challenge disabled');
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1].reason, reason);
    assert.equal(logs[0][1].upstreamStatus, upstream);
    assert.equal(logs[0][1].providerCode, name);
    assert.equal(logs[0][1].requestId, body.error.requestId);
    assert.ok(!JSON.stringify(body).includes('owner@example.invalid'));
    assert.ok(!JSON.stringify(logs).includes('owner@example.invalid'));
  });
}

test('upstream error names containing arbitrary content are never logged', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ name: process.env.RESEND_API_KEY, message: 'Denied' }), { status: 403 }));
  assert.equal((await POST(request())).status, 503);
  assert.equal(logs[0][1].providerCode, 'unknown');
});

test('timeout is distinguishable from HTTP rejection and mapped to 504', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new DOMException('Sensitive upstream details', 'TimeoutError'); });
  assert.equal((await POST(request())).status, 504);
  assert.equal(logs[0][1].reason, 'timeout');
  assert.equal(logs[0][1].upstreamStatus, null);
});

test('DNS failure is distinguishable without logging the raw exception', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('Sensitive transport details', { cause: { code: 'ENOTFOUND' } }); });
  assert.equal((await POST(request())).status, 503);
  assert.equal(logs[0][1].reason, 'dns_failure');
  assert.equal(logs[0][1].upstreamStatus, null);
});
