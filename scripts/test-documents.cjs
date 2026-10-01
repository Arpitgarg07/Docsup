// Opt-in LIVE smoke test: creates only synthetic fixtures and cleans up only those
// fixtures. Requires existing DATABASE_URL/Appwrite configuration and Playwright.
// Run against a local app whose process uses the same root .env. Never targets a
// remote app. No API response is mocked during the successful document lifecycle.
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomInt, createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const { Client, Storage } = require('node-appwrite');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.DOCSUP_TEST_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Test requires a local app');
assert.equal(process.env.DOCSUP_LIVE_TEST, '1', 'Set DOCSUP_LIVE_TEST=1 to allow synthetic live fixtures');
const db = new PrismaClient();
const storage = new Storage(new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));
const bucketId = process.env.APPWRITE_BUCKET_ID;
const prefix = `docsup-smoke-${randomUUID()}`;
const userIds = [];
const familyIds = [];
let browser;

function pdf() {
  const text = 'BT /F1 12 Tf 40 100 Td (Docsup synthetic test - no personal data) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}

async function fixture(label, role = 'OWNER') {
  const user = await db.user.create({ data: { email: `${prefix}-${label.toLowerCase()}@example.invalid`, name: `Synthetic ${label}` } });
  userIds.push(user.id);
  const family = await db.family.create({ data: { name: `${prefix} ${label}`, approvalMode: 'EVERY_UPLOAD', members: { create: { userId: user.id, role } }, profiles: { create: { name: `Synthetic ${label} profile` } }, categories: { create: { name: 'Synthetic documents', slug: 'synthetic' } } }, include: { profiles: true, categories: true } });
  familyIds.push(family.id);
  return { user, family };
}

async function signIn(context, user) {
  const code = String(randomInt(100000, 999999));
  // Supply a synthetic OTP challenge; exercise the existing verification/session
  // endpoint without depending on the unimplemented OTP delivery adapter.
  await db.otpChallenge.create({ data: { userId: user.id, destination: user.email, codeHash: createHash('sha256').update(code).digest('hex'), expiresAt: new Date(Date.now() + 300_000) } });
  const response = await context.request.post(`${base}/api/auth/otp/verify`, { data: { destination: user.email, code } });
  assert.equal(response.status(), 200, 'Existing session creation must succeed');
}

async function sessionRequest(context, method, route, options = {}) {
  // Chromium accepts Secure cookies on trusted loopback origins. Playwright's
  // standalone request client does not consistently do so over HTTP; explicitly
  // send the same real session cookie for API-level isolation assertions.
  const cookie = (await context.cookies()).filter(item => item.name === 'docsup_session').map(item => `${item.name}=${item.value}`).join('; ');
  assert.ok(cookie, 'Synthetic session cookie must exist');
  return context.request[method](base + route, { ...options, headers: { ...options.headers, Cookie: cookie } });
}

async function main() {
  const bucket = await storage.getBucket({ bucketId });
  assert.equal(bucket.fileSecurity, true);
  assert.deepEqual(bucket.$permissions, []);
  const a = await fixture('A');
  const b = await fixture('B');
  const viewer = await db.user.create({ data: { email: `${prefix}-viewer@example.invalid`, name: 'Synthetic viewer' } });
  userIds.push(viewer.id);
  await db.familyMember.create({ data: { userId: viewer.id, familyId: a.family.id, role: 'VIEWER' } });
  browser = await chromium.launch({ headless: true, ...(process.env.DOCSUP_BROWSER ? { executablePath: process.env.DOCSUP_BROWSER } : {}) });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
  await signIn(context, a.user);
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  const appwriteBrowserRequests = [];
  page.on('request', request => { if (new URL(request.url()).hostname.endsWith('appwrite.io')) appwriteBrowserRequests.push(true); });
  const dashboardResponse = await page.goto(`${base}/dashboard`);
  assert.equal(dashboardResponse.status(), 200, 'Dashboard must load');
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await page.waitForURL(`${base}/documents`);
  await page.getByRole('heading', { name: 'No documents yet' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Documents', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('select').first().locator('option').count(), 1);
  console.log('PASS Dashboard -> Documents, scoped family choices, real empty list');
  const wrongProfile = await sessionRequest(context, 'post', '/api/documents', { multipart: { familyId: a.family.id, profileId: b.family.profiles[0].id, categoryId: a.family.categories[0].id, title: 'Synthetic rejected cross-family profile', documentType: 'Synthetic test', file: { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: pdf() } } });
  assert.equal(wrongProfile.status(), 404);
  console.log('PASS cross-family profile upload rejected by the real backend');

  await page.getByLabel('Title', { exact: true }).fill('Synthetic lifecycle PDF');
  await page.getByLabel('Document type', { exact: true }).fill('Synthetic test');
  await page.locator('select[name="profileId"]').selectOption(a.family.profiles[0].id);
  await page.locator('select[name="categoryId"]').selectOption(a.family.categories[0].id);
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'contents do not match' }).waitFor();
  assert.equal(await db.document.count({ where: { familyId: a.family.id } }), 0);
  console.log('PASS real backend signature rejection: UI error, no fake success or DB record');

  const bytes = pdf();
  await page.getByLabel('File', { exact: true }).setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: bytes });
  const uploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/documents' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  const uploaded = await uploadResponse;
  const body = await uploaded.json();
  assert.equal(uploaded.status(), 201, body.error?.message || 'Upload must succeed');
  const documentId = body.data.id;
  await page.getByRole('button', { name: 'View document: Synthetic lifecycle PDF' }).waitFor();
  await page.getByRole('heading', { name: 'Document details', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve document', exact: true }).waitFor();
  const doc = await db.document.findUniqueOrThrow({ where: { id: documentId }, include: { versions: true } });
  assert.equal(doc.familyId, a.family.id);
  assert.equal(doc.profileId, a.family.profiles[0].id);
  assert.equal(doc.status, 'PENDING_APPROVAL');
  const version = doc.versions[0];
  assert.equal(version.checksum, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(Number(version.byteSize), bytes.length);
  const stored = await storage.getFile({ bucketId, fileId: version.storageFileId });
  assert.deepEqual(stored.$permissions, []);
  assert.equal(stored.sizeOriginal, bytes.length);
  assert.deepEqual(Buffer.from(await storage.getFileDownload({ bucketId, fileId: version.storageFileId })), bytes);
  console.log('PASS real upload -> private Appwrite bytes -> PostgreSQL version/checksum -> UI list/detail');
  if (process.env.DOCSUP_SCREENSHOT) {
    await page.screenshot({ path: process.env.DOCSUP_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.DOCSUP_SCREENSHOT.replace('.png', '-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile workspace must not overflow horizontally');
    await page.setViewportSize({ width: 1440, height: 1100 });
  }

  assert.equal(await page.getByRole('button', { name: 'Download original' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Approve document', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Document approved.' }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Download original' && !button.disabled));
  const tokenResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/documents/${documentId}/download`);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original' }).click();
  const downloaded = await downloadEvent;
  const downloadedBytes = await readFile(await downloaded.path());
  assert.deepEqual(downloadedBytes, bytes);
  const access = (await (await tokenResponse).json()).data;
  assert.ok(access.url.startsWith('/api/storage/access?token='));
  assert.deepEqual(appwriteBrowserRequests, []);
  console.log('PASS UI approval -> authenticated token endpoint -> byte-identical secure download; no browser Appwrite requests');

  // Direct anonymous Appwrite access is a negative test, NOT the app download path.
  const privateUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${version.storageFileId}/download`;
  const anonymous = await fetch(privateUrl, { headers: { 'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID } });
  assert.ok([401, 403, 404].includes(anonymous.status), 'Appwrite must deny anonymous access');
  console.log('PASS anonymous direct Appwrite access denied');

  const outsider = await browser.newContext();
  await signIn(outsider, b.user);
  for (const [method, route] of [['get', `/api/documents?familyId=${a.family.id}`], ['get', `/api/documents/${documentId}`], ['post', `/api/documents/${documentId}/download`], ['delete', `/api/documents/${documentId}`]]) {
    const denied = await sessionRequest(outsider, method, route);
    assert.equal(denied.status(), 404, 'Authenticated Family B must not access Family A');
  }
  assert.equal((await sessionRequest(outsider, 'get', access.url)).status(), 401);
  const tampered = access.url.slice(0, -1) + (access.url.endsWith('A') ? 'B' : 'A');
  assert.equal((await sessionRequest(context, 'get', tampered)).status(), 401);
  assert.equal((await sessionRequest(context, 'get', access.url)).status(), 200, 'Authorized reuse remains safe within token lifetime');
  const viewerContext = await browser.newContext();
  await signIn(viewerContext, viewer);
  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(base + '/documents');
  await viewerPage.getByText('Your viewer role cannot upload documents.').waitFor();
  await viewerPage.getByRole('button', { name: 'View document: Synthetic lifecycle PDF' }).click();
  await viewerPage.getByRole('button', { name: 'Download original' }).waitFor();
  assert.equal(await viewerPage.getByRole('button', { name: 'Delete document', exact: true }).count(), 0);
  const viewerDelete = await sessionRequest(viewerContext, 'delete', `/api/documents/${documentId}`);
  assert.equal(viewerDelete.status(), 404);
  console.log('PASS cross-family list/detail/token/download/delete denial; viewer restrictions; token tampering rejected');

  // Negative frontend transport check only; the real lifecycle above is not mocked.
  await page.route('**/api/documents?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Synthetic list outage' } }) }));
  await page.getByRole('button', { name: 'Refresh documents' }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic list outage' }).waitFor();
  await page.unroute('**/api/documents?*');
  await page.getByRole('button', { name: 'Retry list' }).click();
  await page.getByRole('button', { name: 'View document: Synthetic lifecycle PDF' }).waitFor();
  await page.getByRole('button', { name: 'Delete document', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: documentId } })).status, 'APPROVED');
  await page.getByRole('button', { name: 'Delete document', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Document deleted and private storage cleaned up.' }).waitFor();
  await page.getByRole('heading', { name: 'No documents yet' }).waitFor();
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: documentId } })).status, 'DELETED');
  await assert.rejects(storage.getFile({ bucketId, fileId: version.storageFileId }), error => error.code === 404);
  assert.equal(await db.auditLog.count({ where: { entityId: documentId, action: 'DOCUMENT_DELETED' } }), 1);
  assert.equal((await sessionRequest(context, 'get', access.url)).status(), 404);
  console.log('PASS list error/retry and delete cancel; real delete -> storage absence -> DELETED + audit -> UI refresh; old token denied');

  const unauthenticated = await browser.newContext();
  const signedOut = await unauthenticated.newPage();
  await signedOut.goto(base + '/documents');
  await signedOut.getByRole('alert').filter({ hasText: 'Sign in required' }).waitFor();
  console.log('PASS signed-out UI does not expose document data');
  console.log('LIVE DOCUMENT FLOW: PASS');
}

async function cleanup() {
  if (browser) await browser.close();
  const versions = await db.documentVersion.findMany({ where: { document: { familyId: { in: familyIds } } } });
  for (const version of versions) {
    try { await storage.deleteFile({ bucketId, fileId: version.storageFileId }); }
    catch (error) { if (error.code !== 404) throw new Error('Synthetic storage cleanup failed; keeping DB fixtures for reconciliation'); }
  }
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { familyId: { in: familyIds } }] } });
  await db.document.deleteMany({ where: { familyId: { in: familyIds } } });
  await db.family.deleteMany({ where: { id: { in: familyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  console.log('Synthetic test files, users, sessions and family records cleaned up');
}

main().catch(error => {
  // Do not print SDK objects, auth cookies or download-token URLs.
  let message = String(error.message);
  for (const key of ['DATABASE_URL', 'APPWRITE_API_KEY', 'SESSION_SECRET']) if (process.env[key]) message = message.split(process.env[key]).join('[REDACTED]');
  console.error('FAIL:', message.replace(/token=[^\s"']+/g, 'token=[REDACTED]'));
  process.exitCode = 1;
}).finally(async () => {
  try { await cleanup(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  await db.$disconnect();
});
