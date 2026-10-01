import { z } from "zod";
import { db } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";
import { apiError, apiOk } from "../../../lib/api";

const querySchema = z.object({ familyId: z.string().min(1), q: z.string().trim().max(120).optional(), status: z.enum(["DRAFT","UPLOADING","PROCESSING","PENDING_APPROVAL","APPROVED","VERIFIED","REJECTED","ARCHIVED","DELETED"]).optional(), profileId: z.string().optional(), categoryId: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const url = new URL(request.url);
  const input = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!input.success) return apiError("Invalid document filters", 422);
  const { familyId, q, status, profileId, categoryId, page, pageSize } = input.data;
  const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId, userId: user.id } } });
  if (!membership) return apiError("Family not found", 404);
  const where = { familyId, ...(status ? { status } : {}), ...(profileId ? { profileId } : {}), ...(categoryId ? { categoryId } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { documentType: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [items, total] = await Promise.all([db.document.findMany({ where, include: { profile: { select: { name: true } }, category: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), db.document.count({ where })]);
  return apiOk({ items, page, pageSize, total, pages: Math.ceil(total / pageSize) });
}
