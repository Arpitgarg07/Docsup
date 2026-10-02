import { db } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/auth";
import { apiError, apiOk } from "../../../../lib/api";
import { parseDocumentSearch, searchDocuments } from "../../../../lib/document-search";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let user;
  try { user = await getCurrentUser(); }
  catch { return apiError("Authentication service is temporarily unavailable", 503); }
  if (!user) return apiError("Authentication required", 401);
  const parsed = parseDocumentSearch(request);
  if (!parsed.success) return apiError("Search filters are invalid", 422);
  try {
    const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId: parsed.data.familyId, userId: user.id } }, select: { id: true } });
    if (!membership) return apiError("Family not found", 404);
    return apiOk(await searchDocuments(parsed.data));
  } catch {
    return apiError("Search is temporarily unavailable", 503);
  }
}
