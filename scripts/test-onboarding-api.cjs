// Opt-in live API smoke test for Phase 1 onboarding. Synthetic users only;
// no OTP values or secrets are printed. Requires a local running app and DB.
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomInt, createHash } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');

const base = process.env.DOCSUP_TEST_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Test requires a local app');
assert.equal(process.env.DOCSUP_ONBOARDING_API_TEST, '1', 'Set DOCSUP_ONBOARDING_API_TEST=1 to allow synthetic live fixtures');
const db = new PrismaClient();
const prefix = `docsup-onboarding-api-${randomUUID()}`;
const userIds = [];
const familyIds = [];

async function createUser(label) {
  const user = await db.user.create({ data: { email: `${prefix}-${label}@example.invalid`, name: `Synthetic ${label}` } });
  userIds.push(user.id);
  return user;
}
async function session(user) {
  const code = String(randomInt(100000, 999999));
  await db.otpChallenge.create({ data: { userId: user.id, destination: user.email, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt: new Date(Date.now() + 300_000) } });
  const response = await fetch(`${base}/api/auth/otp/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ destination: user.email, code }) });
  assert.equal(response.status, 200, 'Synthetic verification must issue a session');
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'Session cookie must be returned');
  return setCookie.split(';', 1)[0];
}
async function call(cookie, method, route, body) {
  const response = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json().catch(() => null);
  return { response, json };
}
function tokenFrom(link) { return new URL(link).pathname.split('/').pop(); }

async function main() {
  const owner = await createUser('owner');
  const recipient = await createUser('recipient');
  const outsider = await createUser('outsider');
  const member = await createUser('member');
  const viewer = await createUser('viewer');
  const expiredRecipient = await createUser('expired-recipient');
  const concurrentRecipient = await createUser('concurrent-recipient');
  const ownerCookie = await session(owner);
  const recipientCookie = await session(recipient);
  const outsiderCookie = await session(outsider);
  const memberCookie = await session(member);
  const viewerCookie = await session(viewer);
  const expiredRecipientCookie = await session(expiredRecipient);
  const concurrentRecipientCookie = await session(concurrentRecipient);

  let result = await call(ownerCookie, 'POST', '/api/families', { name: 'Synthetic API Family' });
  assert.equal(result.response.status, 201);
  const familyId = result.json.data.id;
  familyIds.push(familyId);
  result = await call(ownerCookie, 'GET', `/api/families/${familyId}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.data.members[0].role, 'OWNER');
  assert.equal(result.json.data.categories.length, 13);
  console.log('PASS live API family create/detail, OWNER membership and seeded categories');

  result = await call(ownerCookie, 'POST', '/api/profiles', { familyId, name: 'Synthetic API Profile', relationship: 'Self' });
  assert.equal(result.response.status, 201);
  const profileId = result.json.data.id;
  assert.ok(await db.auditLog.findFirst({ where: { familyId, entityType: 'Profile', entityId: profileId, action: 'SETTINGS_CHANGED' } }), 'Profile mutation must have an audit event');
  result = await call(ownerCookie, 'PATCH', `/api/profiles/${profileId}`, { name: 'Synthetic API Profile Updated', relationship: 'Self' });
  assert.equal(result.response.status, 200);
  result = await call(ownerCookie, 'POST', '/api/categories', { familyId, name: 'Custom API Category' });
  assert.equal(result.response.status, 201);
  assert.ok(await db.auditLog.findFirst({ where: { familyId, entityType: 'Category', entityId: result.json.data.id, action: 'SETTINGS_CHANGED' } }), 'Category mutation must have an audit event');
  assert.equal((await call(ownerCookie, 'POST', '/api/categories', { familyId, name: 'Custom API Category' })).response.status, 409);
  console.log('PASS live API profile/category mutations and atomic audit events');

  result = await call(ownerCookie, 'POST', `/api/families/${familyId}/invite`, { email: recipient.email, role: 'MEMBER' });
  assert.equal(result.response.status, 201);
  const inviteToken = tokenFrom(result.json.data.link);
  assert.match(result.json.data.code, /^DOC-[A-F0-9]{32}$/i, 'New invitation codes must contain at least 128 random bits');
  const createInviteAudits = await db.auditLog.findMany({ where: { familyId, entityType: 'FamilyInvite', entityId: result.json.data.id } });
  assert.equal(createInviteAudits.length, 1, 'Invite creation and its audit must be atomic');
  assert.equal(createInviteAudits[0].action, 'PERMISSION_CHANGED');
  assert.equal((await call(outsiderCookie, 'POST', '/api/families/invitations/accept', { token: inviteToken })).response.status, 403);
  assert.equal((await call(outsiderCookie, 'POST', '/api/families/invitations/accept', { code: 'DOC-ABC123' })).response.status, 422);
  assert.equal((await call(recipientCookie, 'POST', '/api/families/invitations/accept', { code: result.json.data.code })).response.status, 200);
  assert.equal((await call(recipientCookie, 'POST', '/api/families/invitations/accept', { token: inviteToken })).response.status, 404);
  assert.equal((await call(outsiderCookie, 'GET', `/api/families/${familyId}`)).response.status, 404);
  assert.equal((await call(outsiderCookie, 'GET', `/api/profiles?familyId=${encodeURIComponent(familyId)}`)).response.status, 404);
  assert.equal((await call(outsiderCookie, 'GET', `/api/categories?familyId=${encodeURIComponent(familyId)}`)).response.status, 404);
  assert.equal((await call(outsiderCookie, 'GET', `/api/families/${familyId}/invite`)).response.status, 403);
  console.log('PASS live API targeted code acceptance, malformed-code rejection, replay rejection and outsider reads');

  for (const [user, cookie, role] of [[member, memberCookie, 'MEMBER'], [viewer, viewerCookie, 'VIEWER']]) {
    result = await call(ownerCookie, 'POST', `/api/families/${familyId}/invite`, { email: user.email, role });
    assert.equal(result.response.status, 201);
    assert.equal((await call(cookie, 'POST', '/api/families/invitations/accept', { token: tokenFrom(result.json.data.link) })).response.status, 200);
  }
  // Repeat management checks after membership is established to cover both non-manager roles.
  for (const cookie of [memberCookie, viewerCookie]) {
    assert.equal((await call(cookie, 'PATCH', `/api/families/${familyId}`, { name: 'Denied update' })).response.status, 403);
    assert.equal((await call(cookie, 'POST', `/api/families/${familyId}/invite`, { role: 'MEMBER' })).response.status, 403);
    assert.equal((await call(cookie, 'POST', '/api/profiles', { familyId, name: 'Denied profile' })).response.status, 403);
    assert.equal((await call(cookie, 'POST', '/api/categories', { familyId, name: 'Denied category' })).response.status, 403);
  }
  console.log('PASS live API MEMBER/VIEWER management denial');

  result = await call(ownerCookie, 'POST', `/api/families/${familyId}/invite`, { email: expiredRecipient.email, role: 'MEMBER' });
  assert.equal(result.response.status, 201);
  await db.familyInvite.update({ where: { id: result.json.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call(expiredRecipientCookie, 'POST', '/api/families/invitations/accept', { code: result.json.data.code })).response.status, 404);
  console.log('PASS live API expired invitation rejection');

  result = await call(ownerCookie, 'POST', `/api/families/${familyId}/invite`, { email: concurrentRecipient.email, role: 'MEMBER' });
  assert.equal(result.response.status, 201);
  const concurrentToken = tokenFrom(result.json.data.link);
  const concurrentClaims = await Promise.all([
    call(concurrentRecipientCookie, 'POST', '/api/families/invitations/accept', { token: concurrentToken }),
    call(concurrentRecipientCookie, 'POST', '/api/families/invitations/accept', { token: concurrentToken }),
  ]);
  assert.equal(concurrentClaims.filter(item => item.response.status === 200).length, 1, 'Concurrent claims must create one membership');
  assert.equal(concurrentClaims.filter(item => item.response.status !== 200).length, 1, 'Concurrent replay must be rejected');
  assert.ok([404, 409].includes(concurrentClaims.find(item => item.response.status !== 200).response.status));
  assert.equal((await call(concurrentRecipientCookie, 'POST', '/api/families/invitations/accept', { token: concurrentToken })).response.status, 404);
  console.log('PASS live API concurrent invitation claim and replay rejection');

  result = await call(ownerCookie, 'POST', `/api/families/${familyId}/invite`, { email: outsider.email, role: 'VIEWER' });
  assert.equal(result.response.status, 201);
  const revokedId = result.json.data.id;
  assert.equal((await call(ownerCookie, 'DELETE', `/api/families/${familyId}/invite?inviteId=${encodeURIComponent(revokedId)}`)).response.status, 200);
  const revokeAudits = await db.auditLog.findMany({ where: { familyId, entityType: 'FamilyInvite', entityId: revokedId } });
  assert.equal(revokeAudits.length, 2, 'Invite revocation and its audit must be atomic');
  assert.deepEqual(revokeAudits.map(audit => audit.action), ['PERMISSION_CHANGED', 'PERMISSION_CHANGED']);
  assert.equal((await call(outsiderCookie, 'POST', '/api/families/invitations/accept', { token: tokenFrom(result.json.data.link) })).response.status, 404);
  assert.equal((await call(ownerCookie, 'DELETE', `/api/profiles/${profileId}`)).response.status, 200);
  console.log('PASS live API revoked invite rejection and unused-profile deletion');
  console.log('LIVE ONBOARDING API FLOW: PASS');
}

async function cleanup() {
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { familyId: { in: familyIds } }] } });
  await db.family.deleteMany({ where: { id: { in: familyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
  console.log('Synthetic onboarding API users, sessions and family records cleaned up');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
