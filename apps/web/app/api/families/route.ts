import { z } from "zod";
import { db } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";
import { apiError, apiOk } from "../../../lib/api";

const createSchema = z.object({ name: z.string().trim().min(2).max(80) });
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const memberships = await db.familyMember.findMany({ where: { userId: user.id }, include: { family: { include: { _count: { select: { members: true, documents: true, profiles: true } } } } }, orderBy: { family: { updatedAt: "desc" } } });
  return apiOk(memberships.map(({ family, role }) => ({ id: family.id, name: family.name, role, counts: family._count })));
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Enter a valid family name", 422);
  const family = await db.family.create({ data: { name: parsed.data.name, members: { create: { userId: user.id, role: "OWNER" } }, categories: { create: ["Identity","Banking","Vehicle","Education","Employment","Medical","Insurance","Property","Legal","Travel","Tax","Certificates","Other"].map((name, sortOrder) => ({ name, slug: name.toLowerCase(), sortOrder, system: true })) }, auditLogs: { create: { userId: user.id, action: "FAMILY_CREATED", metadata: { name: parsed.data.name } } } }, select: { id: true, name: true, createdAt: true } });
  return apiOk(family, 201);
}
