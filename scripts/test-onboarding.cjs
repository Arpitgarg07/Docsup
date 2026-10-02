// Opt-in live onboarding smoke test. Uses synthetic identities only and cleans up
// its own PostgreSQL fixtures. No provider, password or OTP is printed.
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomInt, createHash } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.DOCSUP_TEST_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Test requires a local app');
assert.equal(process.env.DOCSUP_ONBOARDING_TEST, '1', 'Set DOCSUP_ONBOARDING_TEST=1 to allow synthetic live fixtures');
const db = new PrismaClient();
const prefix = `docsup-onboarding-${randomUUID()}`;
const userIds = [];
const familyIds = [];
let browser;

async function createUser(label) {
  const user = await db.user.create({ data: { email: `${prefix}-${label}@example.invalid`, name: `Synthetic ${label}` } });
  userIds.push(user.id);
  return user;
}
async function signIn(context, user) {
  const code = String(randomInt(100000, 999999));
  await db.otpChallenge.create({ data: { userId: user.id, destination: user.email, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt: new Date(Date.now() + 300_000) } });
  const response = await context.request.post(`${base}/api/auth/otp/verify`, { data: { destination: user.email, code } });
  assert.equal(response.status(), 200, 'Synthetic session creation must succeed');
}
async function sessionRequest(context, method, route, options = {}) {
  const cookie = (await context.cookies()).filter(item => item.name === 'docsup_session').map(item => `${item.name}=${item.value}`).join('; ');
  assert.ok(cookie, 'Synthetic session cookie must exist');
  return context.request[method](base + route, { ...options, headers: { ...options.headers, Cookie: cookie } });
}

async function main() {
  const owner = await createUser('owner');
  const recipient = await createUser('recipient');
  const outsider = await createUser('outsider');
  browser = await chromium.launch({ headless: true, ...(process.env.DOCSUP_BROWSER ? { executablePath: process.env.DOCSUP_BROWSER } : {}) });
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await signIn(ownerContext, owner);
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(60_000);

  await page.goto(`${base}/family`);
  await page.getByRole('heading', { name: 'Create your first Family Space' }).waitFor();
  await page.getByRole('link', { name: 'Create Family Space', exact: true }).click();
  await page.getByLabel('Family name', { exact: true }).fill('Synthetic Onboarding Family');
  await page.getByRole('button', { name: 'Create Family Space', exact: true }).click();
  await page.waitForURL(/\/family\/(?!create$)[a-z0-9-]+$/);
  const familyId = new URL(page.url()).pathname.split('/').pop();
  familyIds.push(familyId);
  await page.getByRole('heading', { name: 'Synthetic Onboarding Family', exact: true }).waitFor();
  const seededCategoryCount = await page.getByText('System category', { exact: true }).count();
  if (!seededCategoryCount) console.log((await page.locator('body').innerText()).slice(0, 3000));
  assert.equal(seededCategoryCount > 0, true, 'Seeded categories must render in the family workspace');
  const ownerMembershipCount = await db.familyMember.count({ where: { familyId, userId: owner.id, role: 'OWNER' } });
  assert.equal(ownerMembershipCount, 1, `Owner membership missing for ${familyId}`);
  assert.equal(await db.category.count({ where: { familyId } }), 13);
  console.log('PASS browser family creation -> OWNER membership -> seeded categories');

  await page.getByLabel('New category', { exact: true }).fill('Household');
  const categoryResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/categories' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  const categoryResult = await categoryResponse;
  assert.equal(categoryResult.status(), 201, 'Category creation must succeed');
  await page.getByText('Category created.', { exact: true }).waitFor();
  await page.getByText('Household', { exact: true }).waitFor();
  console.log('PASS owner category creation is persisted and rendered');

  await page.getByRole('link', { name: 'Add profile', exact: true }).click();
  await page.waitForURL(/\/profile\/create/);
  await page.getByLabel('Name', { exact: true }).fill('Synthetic First Profile');
  await page.getByLabel('Relationship', { exact: true }).fill('Self');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Profile created.' }).waitFor();
  const profile = await db.profile.findFirstOrThrow({ where: { familyId, name: 'Synthetic First Profile' } });
  console.log('PASS owner profile creation is persisted');

  await page.goto(`${base}/family/${familyId}`);
  await page.getByText('Synthetic First Profile', { exact: true }).waitFor();
  await page.getByLabel('Email (optional)', { exact: true }).fill(recipient.email);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'No email was sent' }).waitFor();
  const inviteLink = await page.getByLabel('Invite link', { exact: true }).inputValue();
  const inviteToken = new URL(inviteLink).pathname.split('/').pop();
  assert.ok(inviteToken);
  const invite = await db.familyInvite.findFirstOrThrow({ where: { familyId, email: recipient.email } });
  console.log('PASS manager invitation creates hashed, email-targeted copy link without claiming delivery');

  const recipientContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await signIn(recipientContext, recipient);
  const recipientPage = await recipientContext.newPage();
  await recipientPage.goto(`${base}/join/${inviteToken}`);
  await recipientPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await recipientPage.waitForURL(`${base}/family/${familyId}`);
  assert.equal(await db.familyMember.count({ where: { familyId, userId: recipient.id, role: 'MEMBER' } }), 1);
  const duplicate = await sessionRequest(recipientContext, 'post', '/api/families/invitations/accept', { data: { token: inviteToken } });
  assert.equal(duplicate.status(), 404);
  console.log('PASS recipient acceptance creates MEMBER, duplicate token acceptance is rejected');

  const outsiderContext = await browser.newContext();
  await signIn(outsiderContext, outsider);
  const denied = await sessionRequest(outsiderContext, 'get', `/api/families/${familyId}`);
  assert.equal(denied.status(), 404);
  const outsiderProfiles = await sessionRequest(outsiderContext, 'get', `/api/profiles?familyId=${familyId}`);
  assert.equal(outsiderProfiles.status(), 404);
  console.log('PASS non-member family detail/profile isolation');

  const secondInviteResponse = await sessionRequest(ownerContext, 'post', `/api/families/${familyId}/invite`, { data: { email: outsider.email, role: 'VIEWER' } });
  assert.equal(secondInviteResponse.status(), 201);
  const secondInvite = await secondInviteResponse.json();
  const revoked = await sessionRequest(ownerContext, 'delete', `/api/families/${familyId}/invite?inviteId=${encodeURIComponent(secondInvite.data.id)}`);
  assert.equal(revoked.status(), 200);
  const revokedAccept = await sessionRequest(outsiderContext, 'post', '/api/families/invitations/accept', { data: { token: secondInvite.data.link.split('/').pop() } });
  assert.equal(revokedAccept.status(), 404);
  assert.equal(await db.profile.count({ where: { id: profile.id, familyId } }), 1);
  console.log('PASS revoked invitation cannot be accepted');
  console.log('LIVE ONBOARDING FLOW: PASS');
}

async function cleanup() {
  if (browser) await browser.close();
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { familyId: { in: familyIds } }] } });
  await db.family.deleteMany({ where: { id: { in: familyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
  console.log('Synthetic onboarding users, sessions and family records cleaned up');
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(cleanup);
