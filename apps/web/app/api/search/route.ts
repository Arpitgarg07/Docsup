import { z } from "zod";
import { db } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";
import { apiError, apiOk } from "../../../lib/api";
const schema = z.object({ familyId: z.string().min(1), q: z.string().trim().min(2).max(120) });
export async function GET(request: Request) {
  const user = await getCurrentUser(); if (!user) return apiError("Authentication required", 401);
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams)); if (!parsed.success) return apiError("Search query is invalid", 422);
  const { familyId, q } = parsed.data; const member = await db.familyMember.findUnique({ where: { familyId_userId: { familyId, userId: user.id } } }); if (!member) return apiError("Family not found", 404);
  const items = await db.document.findMany({ where: { familyId, OR: [{ title: { contains: q, mode: "insensitive" } }, { documentType: { contains: q, mode: "insensitive" } }, { metadata: { some: { value: { contains: q, mode: "insensitive" } } } }] }, select: { id: true, title: true, documentType: true, status: true, profile: { select: { name: true } }, category: { select: { name: true } } }, take: 20, orderBy: { updatedAt: "desc" } });
  return apiOk({ items });
}
