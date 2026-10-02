// Opt-in live search API smoke test. It uses synthetic PostgreSQL metadata only;
// no Appwrite objects, OTP values or secrets are printed.
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomInt, createHash } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');

const base = process.env.DOCSUP_SEARCH_TEST_URL || process.env.DOCSUP_TEST_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Test requires a local app');
assert.equal(process.env.DOCSUP_SEARCH_TEST, '1', 'Set DOCSUP_SEARCH_TEST=1 to allow synthetic live fixtures');
const db = new PrismaClient();
const prefix = `docsup-search-${randomUUID()}`;
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
async function call(cookie, route) {
  const response = await fetch(`${base}${route}`, { headers: { Cookie: cookie } });
  const json = await response.json().catch(() => null);
  return { response, json };
}
async function createDocument({ familyId, profileId, categoryId, title, documentType, fileName, status = 'APPROVED', createdAt, verifiedAt, metadataValue }) {
  return db.document.create({ data: {
    familyId, profileId, categoryId, uploadedById: userIds[0], title, documentType, status, createdAt, ...(verifiedAt ? { verifiedAt } : {}),
    versions: { create: { kind: 'ORIGINAL', objectKey: `synthetic/${randomUUID()}`, storageProvider: 'appwrite', storageFileId: `synthetic-${randomUUID()}`, fileName, mimeType: 'application/pdf', byteSize: 128n } },
    ...(metadataValue ? { metadata: { create: { field: 'document_number', value: metadataValue, source: 'SYNTHETIC', needsReview: false } } } : {}),
  } });
}

async function main() {
  const owner = await createUser('owner');
  const viewer = await createUser('viewer');
  const outsider = await createUser('outsider');
  const ownerCookie = await session(owner);
  const viewerCookie = await session(viewer);
  const outsiderCookie = await session(outsider);
  const familyA = await db.family.create({ data: { name: `${prefix} A`, members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: viewer.id, role: 'VIEWER' }] }, profiles: { create: [{ name: 'Alice' }, { name: 'Bob' }] }, categories: { create: [{ name: 'Identity', slug: 'identity' }, { name: 'Education', slug: 'education' }] } }, include: { profiles: true, categories: true } });
  const familyB = await db.family.create({ data: { name: `${prefix} B`, members: { create: { userId: outsider.id, role: 'OWNER' } }, profiles: { create: { name: 'Other Person' } }, categories: { create: { name: 'Identity', slug: 'identity' } } }, include: { profiles: true, categories: true } });
  familyIds.push(familyA.id, familyB.id);
  const identity = familyA.categories.find(category => category.slug === 'identity');
  const education = familyA.categories.find(category => category.slug === 'education');
  const alice = familyA.profiles.find(profile => profile.name === 'Alice');
  const bob = familyA.profiles.find(profile => profile.name === 'Bob');
  await createDocument({ familyId: familyA.id, profileId: alice.id, categoryId: identity.id, title: 'Family Passport', documentType: 'Identity', fileName: 'passport-scan.pdf', createdAt: new Date('2024-01-10T12:00:00.000Z'), metadataValue: 'AB123456' });
  await createDocument({ familyId: familyA.id, profileId: bob.id, categoryId: education.id, title: 'School Certificate', documentType: 'Education', fileName: 'school-certificate.pdf', status: 'VERIFIED', verifiedAt: new Date('2024-02-10T12:00:00.000Z'), createdAt: new Date('2024-02-10T12:00:00.000Z') });
  await createDocument({ familyId: familyA.id, profileId: alice.id, categoryId: identity.id, title: 'Hidden Deleted Passport', documentType: 'Identity', fileName: 'deleted.pdf', status: 'DELETED', createdAt: new Date('2024-03-10T12:00:00.000Z') });
  await createDocument({ familyId: familyB.id, profileId: familyB.profiles[0].id, categoryId: familyB.categories[0].id, title: 'Family Passport Other', documentType: 'Identity', fileName: 'other.pdf', createdAt: new Date('2024-01-11T12:00:00.000Z') });

  const unauthenticated = await fetch(`${base}/api/search/documents?familyId=${familyA.id}&q=passport`);
  assert.equal(unauthenticated.status, 401);
  let result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&q=passport`);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json.data.items.map(item => item.title), ['Family Passport']);
  assert.equal(result.json.data.total, 1);
  assert.ok(result.json.data.items[0].versions[0].fileName === 'passport-scan.pdf');
  assert.equal(JSON.stringify(result.json).includes('storageFileId'), false);
  assert.equal(JSON.stringify(result.json).includes('objectKey'), false);
  assert.equal(JSON.stringify(result.json).includes('docsup_session'), false);
  console.log('PASS authenticated family-scoped title search and private-field omission');

  for (const query of ['q=PASSPORT-SCAN', `q=AB123456`, 'q=alice', 'q=education']) {
    result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&${query}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.json.data.items.length, 1, query);
  }
  result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&profileId=${bob.id}&categoryId=${education.id}&status=VERIFIED&verificationStatus=VERIFIED&from=2024-02-01&to=2024-02-28`);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.data.items.length, 1);
  assert.equal(result.json.data.items[0].title, 'School Certificate');
  result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&verificationStatus=UNVERIFIED`);
  assert.equal(result.json.data.items.length, 1);
  assert.equal(result.json.data.items[0].title, 'Family Passport');
  console.log('PASS filename, persisted metadata, profile/category, status, verification and date filters');

  result = await call(viewerCookie, `/api/search/documents?familyId=${familyA.id}&q=passport`);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.data.items.length, 1);
  result = await call(outsiderCookie, `/api/search/documents?familyId=${familyA.id}&q=passport`);
  assert.equal(result.response.status, 404);
  assert.equal((await call(outsiderCookie, `/api/search/documents?familyId=${familyB.id}&q=passport`)).response.status, 200);
  result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&q=deleted`);
  assert.equal(result.json.data.items.length, 0);
  console.log('PASS viewer access and cross-family/deleted-document isolation');

  for (const route of [`/api/search/documents?familyId=${familyA.id}&q=x`, `/api/search/documents?familyId=${familyA.id}&page=0`, `/api/search/documents?familyId=${familyA.id}&pageSize=51`, `/api/search/documents?familyId=${familyA.id}&from=2024-03-01&to=2024-02-01`, `/api/search/documents?familyId=${familyA.id}&status=DELETED`]) {
    assert.equal((await call(ownerCookie, route)).response.status, 422, route);
  }
  result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&page=1&pageSize=1`);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.data.items.length, 1);
  assert.equal(result.json.data.hasNextPage, true);
  const firstId = result.json.data.items[0].id;
  result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}&page=2&pageSize=1`);
  assert.equal(result.json.data.items.length, 1);
  assert.notEqual(result.json.data.items[0].id, firstId);
  result = await call(ownerCookie, `/api/search/documents?familyId=${familyA.id}`);
  assert.equal(result.json.data.total, 2);
  assert.equal(result.json.data.items.length, 2);
  result = await call(ownerCookie, `/api/search?familyId=${familyA.id}&q=certificate`);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.data.items[0].title, 'School Certificate');
  console.log('PASS validation, bounded pagination, clear-filter dataset and compatibility route');
  console.log('LIVE SEARCH API FLOW: PASS');
}

async function cleanup() {
  await db.document.deleteMany({ where: { familyId: { in: familyIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { familyId: { in: familyIds } }] } });
  await db.family.deleteMany({ where: { id: { in: familyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
  console.log('Synthetic search users, sessions, families and document metadata cleaned up');
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(cleanup);
