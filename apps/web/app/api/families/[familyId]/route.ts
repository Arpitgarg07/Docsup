import { z } from "zod";
import { db } from "../../../../lib/db";
import { requireFamilyMember } from "../../../../lib/auth";
import { apiError, apiOk } from "../../../../lib/api";

export const runtime = "nodejs";

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export async function GET(_: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  let actor;
  try {
    actor = await requireFamilyMember(familyId);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
    if (error instanceof Error && error.message === "FORBIDDEN") return apiError("Family not found", 404);
    return apiError("Family data is temporarily unavailable", 503);
  }
  try {
    const family = await db.family.findUnique({ where: { id: familyId }, select: {
      id: true, name: true, approvalMode: true, createdAt: true, updatedAt: true,
      members: { orderBy: { joinedAt: "asc" }, select: { id: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true, phone: true } } } },
      profiles: { orderBy: { name: "asc" }, select: { id: true, name: true, relationship: true, dateOfBirth: true, createdAt: true, updatedAt: true, _count: { select: { documents: true } } } },
      categories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, slug: true, system: true, sortOrder: true } },
      invites: actor.membership.role === "OWNER" || actor.membership.role === "ADMIN" ? { orderBy: { expiresAt: "desc" }, select: { id: true, email: true, role: true, expiresAt: true, revokedAt: true, acceptedAt: true } } : false,
    } });
    if (!family) return apiError("Family not found", 404);
    return apiOk({ ...family, viewerRole: actor.membership.role });
  } catch {
    return apiError("Family data is temporarily unavailable", 503);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  let actor;
  try {
    actor = await requireFamilyMember(familyId, ["OWNER", "ADMIN"]);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
    if (error instanceof Error && error.message === "FORBIDDEN") return apiError("You cannot manage this family", 403);
    return apiError("Family data is temporarily unavailable", 503);
  }
  const parsed = z.object({ name: z.string().trim().min(2).max(80).optional(), approvalMode: z.enum(["EVERY_UPLOAD", "SENSITIVE_ONLY", "NONE"]).optional() }).refine(value => value.name !== undefined || value.approvalMode !== undefined).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Enter a valid family update", 422);
  try {
    const family = await db.$transaction(async tx => {
      const updated = await tx.family.update({ where: { id: familyId }, data: parsed.data, select: { id: true, name: true, approvalMode: true, updatedAt: true } });
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId, action: "SETTINGS_CHANGED", entityType: "Family", entityId: familyId, metadata: { fields: Object.keys(parsed.data) } } });
      return updated;
    });
    return apiOk(family);
  } catch (error) {
    if (databaseErrorCode(error) === "P2025") return apiError("Family not found", 404);
    return apiError("Family settings could not be updated", 503);
  }
}
