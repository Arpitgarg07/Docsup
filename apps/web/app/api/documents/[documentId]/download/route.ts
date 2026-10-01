import { db } from "../../../../../lib/db";
import { getCurrentUser } from "../../../../../lib/auth";
import { apiError, apiOk } from "../../../../../lib/api";
import { getStorageProvider } from "../../../../../lib/storage";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const { documentId } = await params;
  const document = await db.document.findFirst({ where: { id: documentId, status: { in: ["APPROVED", "VERIFIED", "ARCHIVED"] }, family: { members: { some: { userId: user.id } } } }, include: { profile: { select: { familyId: true } }, versions: { where: { kind: "ORIGINAL", storageProvider: "appwrite" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const version = document?.versions[0];
  if (!document || !version || document.profile.familyId !== document.familyId) return apiError("Document not found", 404);
  try {
    const storage = getStorageProvider();
    if (!(await storage.exists(version.storageFileId))) return apiError("Document unavailable", 404);
    const access = await storage.createSecureAccess({ fileId: version.storageFileId, versionId: version.id, documentId: document.id, familyId: document.familyId, userId: user.id }, 5 * 60);
    return apiOk({ url: `/api/storage/access?token=${encodeURIComponent(access.token)}`, expiresAt: access.expiresAt });
  } catch {
    return apiError("Secure download is not configured", 503);
  }
}
