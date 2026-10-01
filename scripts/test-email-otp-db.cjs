// Opt-in PostgreSQL integration check. Resend HTTP is ALWAYS mocked in this
// process, even if real credentials are configured. No email is sent or logged.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
assert.equal(process.env.DOCSUP_AUTH_TEST, '1', 'Set DOCSUP_AUTH_TEST=1 to permit synthetic DB fixtures');
process.env.RESEND_API_KEY = 're_synthetic_not_a_real_key';
process.env.AUTH_EMAIL_FROM = 'Docsup <signin@example.invalid>';
const { db } = require('../apps/web/lib/db.ts');
const { POST } = require('../apps/web/app/api/auth/otp/request/route.ts');
const destination = `docsup-email-${randomUUID()}@example.invalid`;
const request = () => new Request('http://localhost/api/auth/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination }) });
let rejectProvider = false;
const acceptedHashes = new Set();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  const body = JSON.parse(options.body);
  assert.deepEqual(body.to, [destination]);
  if (rejectProvider) return new Response('{}', { status: 403 });
  const code = body.text.match(/code is: (\d{6})/)[1];
  acceptedHashes.add(createHash('sha256').update(code).digest('hex'));
  return new Response(JSON.stringify({ id: randomUUID() }), { status: 200 });
};

(async () => {
  try {
    assert.equal((await POST(request())).status, 200);
    let rows = await db.otpChallenge.findMany({ where: { destination } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].consumedAt, null);
    assert.ok(acceptedHashes.has(rows[0].codeHash));
    assert.ok(rows[0].expiresAt > new Date());
    rejectProvider = true;
    assert.equal((await POST(request())).status, 503);
    rows = await db.otpChallenge.findMany({ where: { destination } });
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(row => row.consumedAt === null).length, 1);
    rejectProvider = false;
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => POST(request())));
    assert.equal(concurrent.filter(response => response.status === 200).length, 3);
    assert.equal(concurrent.filter(response => response.status === 429).length, 5);
    rows = await db.otpChallenge.findMany({ where: { destination } });
    assert.equal(rows.length, 5);
    const active = rows.filter(row => row.consumedAt === null);
    assert.equal(active.length, 1);
    assert.ok(acceptedHashes.has(active[0].codeHash));
    console.log('PASS PostgreSQL reservation/activation, failed-send invalidation, prior-code replacement and atomic five-per-ten-minute limit under concurrent requests');
    console.log('Provider HTTP was mocked; NO real email delivery was performed.');
  } catch (error) {
    console.error('Email OTP database check failed:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    await db.otpChallenge.deleteMany({ where: { destination } });
    await db.$disconnect();
    console.log('Synthetic email challenges cleaned up');
  }
})();
