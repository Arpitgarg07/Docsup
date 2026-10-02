import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { requireFamilyMember } from "../../../../../lib/auth";
import { apiError, apiOk } from "../../../../../lib/api";

export const runtime = "nodejs";
const schema = z.object({ email: z.email().optional(), role: z.enum(["ADMIN", "MEMBER", "UPLOADER", "VIEWER"]).default("MEMBER") });

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function requireManager(familyId: string) {
  return requireFamilyMember(familyId, ["OWNER", "ADMIN"]);
}

function managerError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
  if (error instanceof Error && error.message === "FORBIDDEN") return apiError("You cannot manage this family", 403);
  return apiError("Family data is temporarily unavailable", 503);
}

export async function GET(_: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  try { await requireManager(familyId); }
  catch (error) { return managerError(error); }
  try {
    const invites = await db.familyInvite.findMany({ where: { familyId }, orderBy: { expiresAt: "desc" }, select: { id: true, email: true, role: true, expiresAt: true, revokedAt: true, acceptedAt: true } });
    return apiOk(invites);
  } catch {
    return apiError("Invitations are temporarily unavailable", 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  let actor;
  try { actor = await requireManager(familyId); }
  catch (error) { return managerError(error); }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Enter a valid invitation", 422);
  const raw = randomBytes(32).toString("base64url");
  // Keep the human-entered code at 128 bits; the old six-hex-digit code was brute-forceable.
  const code = `DOC-${randomBytes(16).toString("hex").toUpperCase()}`;
  try {
    const invite = await db.$transaction(async tx => {
      const created = await tx.familyInvite.create({ data: { familyId, inviterId: actor.user.id, email: parsed.data.email?.toLowerCase(), role: parsed.data.role, tokenHash: createHash("sha256").update(raw).digest("hex"), codeHash: createHash("sha256").update(code).digest("hex"), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, select: { id: true, email: true, role: true, expiresAt: true } });
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId, action: "PERMISSION_CHANGED", entityType: "FamilyInvite", entityId: created.id, metadata: { change: "created", role: created.role } } });
      return created;
    });
    return apiOk({ ...invite, code, link: `${process.env.APP_URL ?? "http://localhost:3000"}/join/${raw}`, delivery: "copy_link_or_code" }, 201);
  } catch {
    return apiError("The invitation could not be created", 503);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  let actor;
  try { actor = await requireManager(familyId); }
  catch (error) { return managerError(error); }
  const inviteId = new URL(request.url).searchParams.get("inviteId");
  if (!inviteId) return apiError("Invitation not found", 404);
  try {
    await db.$transaction(async tx => {
      const result = await tx.familyInvite.updateMany({ where: { id: inviteId, familyId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (result.count !== 1) throw new Error("INVITE_NOT_FOUND");
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId, action: "PERMISSION_CHANGED", entityType: "FamilyInvite", entityId: inviteId, metadata: { change: "revoked" } } });
    });
    return apiOk({ revoked: true });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_NOT_FOUND") return apiError("Invitation not found or already used", 404);
    if (databaseErrorCode(error) === "P2025") return apiError("Invitation not found or already used", 404);
    return apiError("The invitation could not be revoked", 503);
  }
}
