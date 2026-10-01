import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

const SESSION_COOKIE = "docsup_session";
const sessionHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(userId: string) {
  const raw = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId, tokenHash: sessionHash(raw), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), userAgent: (await headers()).get("user-agent")?.slice(0, 250) } });
  (await cookies()).set(SESSION_COOKIE, raw, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function getCurrentUser() {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sessionHash(raw) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return session.user;
}

export async function destroySession() {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (raw) await db.session.deleteMany({ where: { tokenHash: sessionHash(raw) } });
  (await cookies()).delete(SESSION_COOKIE);
}

export async function requireFamilyMember(familyId: string, roles?: string[]) {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId, userId: user.id } } });
  if (!membership || (roles && !roles.includes(membership.role))) throw new Error("FORBIDDEN");
  return { user, membership };
}
