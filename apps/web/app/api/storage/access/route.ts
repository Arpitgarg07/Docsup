import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/auth";
import { apiError } from "../../../../lib/api";
import { checksum } from "../../../../lib/upload";
import { getStorageProvider } from "../../../../lib/storage";
import { verifyStorageAccess } from "../../../../lib/storage-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);

  const token = new URL(request.url).searchParams.get("token");
  const access = token ? verifyStorageAccess(token, { userId: user.id }) : null;
  if (!access) return apiError("Download link expired or invalid", 401);

  const version = await db.documentVersion.findFirst({ where: { storageFileId: access.fileId, storageProvider: "appwrite", document: { status: { in: ["APPROVED", "VERIFIED", "ARCHIVED"] } } }, include: { document: { select: { familyId: true, profile: { select: { familyId: true } } } } } });
  if (!version || access.versionId !== version.id || access.documentId !== version.documentId || access.familyId !== version.document.familyId || version.document.profile.familyId !== version.document.familyId) return apiError("Document unavailable", 404);

  const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId: version.document.familyId, userId: user.id } } });
  if (!membership) return apiError("Document unavailable", 404);

  try {
    const body = await getStorageProvider().download(access.fileId);
    if (body.byteLength !== Number(version.byteSize) || (version.checksum && checksum(new Uint8Array(body)) !== version.checksum)) return apiError("Document integrity check failed", 503);
    await db.auditLog.create({ data: { userId: user.id, familyId: version.document.familyId, action: "DOCUMENT_DOWNLOADED", entityType: "Document", entityId: version.documentId } });
    return new NextResponse(body, { headers: { "Content-Type": version.mimeType, "Content-Length": String(body.byteLength), "Content-Disposition": `attachment; filename="${version.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return apiError("Document download failed", 503);
  }
}
