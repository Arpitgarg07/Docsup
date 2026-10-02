import { z } from "zod";
import { db } from "../../../lib/db";
import { requireFamilyMember } from "../../../lib/auth";
import { apiError, apiOk } from "../../../lib/api";

export const runtime = "nodejs";
const schema = z.object({ familyId: z.string().min(1), name: z.string().trim().min(1).max(60) });
function slugFor(name: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "category";
}
function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export async function GET(request: Request) {
  const familyId = new URL(request.url).searchParams.get("familyId");
  if (!familyId) return apiError("Family is required", 422);
  try { await requireFamilyMember(familyId); }
  catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
    if (error instanceof Error && error.message === "FORBIDDEN") return apiError("Family not found", 404);
    return apiError("Category service is temporarily unavailable", 503);
  }
  try {
    const categories = await db.category.findMany({ where: { familyId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, slug: true, system: true, sortOrder: true } });
    return apiOk(categories);
  } catch {
    return apiError("Category service is temporarily unavailable", 503);
  }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Enter a valid category", 422);
  let actor;
  try { actor = await requireFamilyMember(parsed.data.familyId, ["OWNER", "ADMIN"]); }
  catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return apiError("Authentication required", 401);
    if (error instanceof Error && error.message === "FORBIDDEN") return apiError("Only family owners and admins can manage categories", 403);
    return apiError("Category service is temporarily unavailable", 503);
  }
  try {
    const category = await db.$transaction(async tx => {
      const last = await tx.category.findFirst({ where: { familyId: parsed.data.familyId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      const created = await tx.category.create({ data: { familyId: parsed.data.familyId, name: parsed.data.name, slug: slugFor(parsed.data.name), sortOrder: (last?.sortOrder ?? -1) + 1 }, select: { id: true, name: true, slug: true, system: true, sortOrder: true } });
      await tx.auditLog.create({ data: { userId: actor.user.id, familyId: parsed.data.familyId, action: "SETTINGS_CHANGED", entityType: "Category", entityId: created.id, metadata: { change: "created" } } });
      return created;
    });
    return apiOk(category, 201);
  } catch (error) {
    if (databaseErrorCode(error) === "P2002") return apiError("That category already exists in this family", 409);
    if (databaseErrorCode(error) === "P2003") return apiError("The family was not found", 404);
    return apiError("The category could not be created", 503);
  }
}
