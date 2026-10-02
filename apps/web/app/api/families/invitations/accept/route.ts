import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { getCurrentUser } from "../../../../../lib/auth";
import { apiError, apiOk } from "../../../../../lib/api";

export const runtime = "nodejs";
const schema = z.object({ token: z.string().trim().min(20).max(200).optional(), code: z.string().trim().regex(/^DOC-[A-F0-9]{32}$/i).optional() }).refine(value => Boolean(value.token || value.code));

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return apiError("Authentication service is temporarily unavailable", 503);
  }
  if (!user) return apiError("Authentication required", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Invitation is invalid or expired", 422);
  const tokenHash = parsed.data.token ? createHash("sha256").update(parsed.data.token).digest("hex") : undefined;
  const codeHash = parsed.data.code ? createHash("sha256").update(parsed.data.code.toUpperCase()).digest("hex") : undefined;
  const lookup = tokenHash ? { tokenHash } : { codeHash };
  const lookupTime = new Date();
  let invite;
  try {
    invite = await db.familyInvite.findFirst({ where: { ...lookup, expiresAt: { gt: lookupTime }, revokedAt: null, acceptedAt: null }, select: { id: true, familyId: true, email: true, role: true, family: { select: { name: true } } } });
  } catch {
    return apiError("Invitation service is temporarily unavailable", 503);
  }
  if (!invite) return apiError("Invitation is invalid or expired", 404);
  if (invite.email && invite.email.toLowerCase() !== user.email?.toLowerCase()) return apiError("This invitation is not addressed to your signed-in email", 403);
  try {
    const result = await db.$transaction(async tx => {
      const existing = await tx.familyMember.findUnique({ where: { familyId_userId: { familyId: invite.familyId, userId: user.id } } });
      if (existing) throw new Error("ALREADY_MEMBER");
      // Check expiry again in the same conditional update that claims the invite.
      const claimedAt = new Date();
      const claimed = await tx.familyInvite.updateMany({ where: { id: invite.id, expiresAt: { gt: claimedAt }, acceptedAt: null, revokedAt: null }, data: { acceptedAt: claimedAt } });
      if (claimed.count !== 1) throw new Error("INVITE_ALREADY_USED");
      await tx.familyMember.create({ data: { familyId: invite.familyId, userId: user.id, role: invite.role } });
      await tx.auditLog.create({ data: { userId: user.id, familyId: invite.familyId, action: "MEMBER_JOINED", entityType: "FamilyInvite", entityId: invite.id } });
      return { familyId: invite.familyId, familyName: invite.family.name, role: invite.role };
    });
    return apiOk(result);
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_MEMBER") return apiError("You are already a member of this family", 409);
    if (error instanceof Error && error.message === "INVITE_ALREADY_USED") return apiError("Invitation could not be accepted. It may have just been used.", 409);
    if (databaseErrorCode(error) === "P2002") return apiError("Invitation could not be accepted. It may have just been used.", 409);
    return apiError("Invitation service is temporarily unavailable", 503);
  }
}
