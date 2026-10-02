import { z } from "zod";
import { db } from "../../../lib/db";
import { requireFamilyMember } from "../../../lib/auth";
import { apiError, apiOk } from "../../../lib/api";

export const runtime = "nodejs";
const profileSchema = z.object({ familyId: z.string().min(1), name: z.string().trim().min(1).max(80), relationship: z.string().trim().max(40).optional(), dateOfBirth: z.string().date().optional() });

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function manager(familyId: string) {
  return requireFamilyMember(familyId, ["OWNER", "ADMIN"]);
}

function managerError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
  if (error instanceof Error && error.message === "FORBIDDEN") return apiError("Only family owners and admins can manage profiles", 403);
  return apiError("Profile service is temporarily unavailable", 503);
}

export async function GET(request: Request) {
  const familyId = new URL(request.url).searchParams.get("familyId");
  if (!familyId) return apiError("Family is required", 422);
  try { await requireFamilyMember(familyId); }
  catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
    if (error instanceof Error && error.message === "FORBIDDEN") return apiError("Family not found", 404);
    return apiError("Profile service is temporarily unavailable", 503);
  }
  try {
    const profiles = await db.profile.findMany({ where: { familyId }, orderBy: { name: "asc" }, select: { id: true, name: true, relationship: true, dateOfBirth: true, createdAt: true, updatedAt: true, _count: { select: { documents: true } } } });
    return apiOk(profiles);
  } catch {
    return apiError("Profile service is temporarily unavailable", 503);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return apiError("Enter a valid profile", 422);
  let actor;
  try { actor = await manager(parsed.data.familyId); }
  catch (error) { return managerError(error); }
  try {
    const profile = await db.$transaction(async tx => {
      const created = await tx.profile.create({ data: { familyId: parsed.data.familyId, name: parsed.data.name, relationship: parsed.data.relationship || null, dateOfBirth: parsed.data.dateOfBirth ? new Date(`${parsed.data.dateOfBirth}T00:00:00.000Z`) : null }, select: { id: true, name: true, relationship: true, dateOfBirth: true, createdAt: true, updatedAt: true } });
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId: parsed.data.familyId, action: "SETTINGS_CHANGED", entityType: "Profile", entityId: created.id, metadata: { change: "created" } } });
      return created;
    });
    return apiOk(profile, 201);
  } catch (error) {
    if (databaseErrorCode(error) === "P2003") return apiError("The profile could not be created for this family", 404);
    return apiError("The profile could not be created", 503);
  }
}
