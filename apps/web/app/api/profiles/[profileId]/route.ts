import { z } from "zod";
import { db } from "../../../../lib/db";
import { requireFamilyMember } from "../../../../lib/auth";
import { apiError, apiOk } from "../../../../lib/api";

export const runtime = "nodejs";
const profileSchema = z.object({ name: z.string().trim().min(1).max(80), relationship: z.string().trim().max(40).optional(), dateOfBirth: z.string().date().nullable().optional() });

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function managementError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
  if (error instanceof Error && error.message === "FORBIDDEN") return apiError("You cannot manage this profile", 403);
  return apiError("Profile service is temporarily unavailable", 503);
}

async function findProfile(profileId: string) {
  return db.profile.findUnique({ where: { id: profileId }, select: { id: true, familyId: true } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  let existing;
  try { existing = await findProfile(profileId); }
  catch { return apiError("Profile service is temporarily unavailable", 503); }
  if (!existing) return apiError("Profile not found", 404);
  let actor;
  try { actor = await requireFamilyMember(existing.familyId, ["OWNER", "ADMIN"]); }
  catch (error) { return managementError(error); }
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Enter a valid profile", 422);
  try {
    const profile = await db.$transaction(async tx => {
      const updated = await tx.profile.update({ where: { id: profileId }, data: { name: parsed.data.name, relationship: parsed.data.relationship || null, dateOfBirth: parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : parsed.data.dateOfBirth === null ? null : undefined }, select: { id: true, name: true, relationship: true, dateOfBirth: true, createdAt: true, updatedAt: true } });
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId: existing.familyId, action: "SETTINGS_CHANGED", entityType: "Profile", entityId: profileId, metadata: { change: "updated" } } });
      return updated;
    });
    return apiOk(profile);
  } catch (error) {
    if (databaseErrorCode(error) === "P2025") return apiError("Profile not found", 404);
    return apiError("The profile could not be updated", 503);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  let existing;
  try { existing = await findProfile(profileId); }
  catch { return apiError("Profile service is temporarily unavailable", 503); }
  if (!existing) return apiError("Profile not found", 404);
  let actor;
  try { actor = await requireFamilyMember(existing.familyId, ["OWNER", "ADMIN"]); }
  catch (error) { return managementError(error); }
  try {
    await db.$transaction(async tx => {
      const current = await tx.profile.findUnique({ where: { id: profileId }, select: { id: true, _count: { select: { documents: true } } } });
      if (!current) throw new Error("PROFILE_NOT_FOUND");
      if (current._count.documents > 0) throw new Error("PROFILE_HAS_DOCUMENTS");
      await tx.profile.delete({ where: { id: profileId } });
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId: existing.familyId, action: "SETTINGS_CHANGED", entityType: "Profile", entityId: profileId, metadata: { change: "deleted" } } });
    });
    return apiOk({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") return apiError("Profile not found", 404);
    if ((error instanceof Error && error.message === "PROFILE_HAS_DOCUMENTS") || databaseErrorCode(error) === "P2003") return apiError("Profiles with documents cannot be deleted. Move or delete those documents first.", 409);
    return apiError("The profile could not be deleted", 503);
  }
}
