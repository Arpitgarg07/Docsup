import { db } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/auth";
import { apiError, apiOk } from "../../../../lib/api";
import { getStorageProvider } from "../../../../lib/storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const { documentId } = await params;
  const document = await db.document.findFirst({ where: { id: documentId, status: { notIn: ["DELETED", "DELETION_PENDING"] }, family: { members: { some: { userId: user.id } } } }, include: { profile: true, category: true, metadata: true, versions: { select: { id: true, kind: true, fileName: true, mimeType: true, byteSize: true, createdAt: true } } } });
  if (!document) return apiError("Document not found", 404);
  await db.auditLog.create({ data: { userId: user.id, familyId: document.familyId, action: "DOCUMENT_VIEWED", entityType: "Document", entityId: document.id } });
  return apiOk({ ...document, versions: document.versions.map((version) => ({ ...version, byteSize: Number(version.byteSize) })) });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const { documentId } = await params;
  const document = await db.document.findFirst({ where: { id: documentId, status: { not: "DELETED" }, family: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } } }, include: { versions: { select: { storageProvider: true, storageFileId: true } } } });
  if (!document) return apiError("Document not found", 404);

  await db.document.update({ where: { id: document.id }, data: { status: "DELETION_PENDING" } });
  try {
    const storage = getStorageProvider();
    for (const version of document.versions) {
      if (version.storageProvider !== "appwrite") throw new Error("UNSUPPORTED_STORAGE_PROVIDER");
      await storage.delete(version.storageFileId);
    }
  } catch {
    await db.auditLog.create({ data: { userId: user.id, familyId: document.familyId, action: "DOCUMENT_DELETION_FAILED", severity: "SECURITY_EVENT", entityType: "Document", entityId: document.id, metadata: { versionCount: document.versions.length } } }).catch(() => undefined);
    return apiError("The document could not be removed from private storage; deletion is pending retry", 503);
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.document.update({ where: { id: document.id }, data: { status: "DELETED" } });
      await tx.auditLog.create({ data: { userId: user.id, familyId: document.familyId, action: "DOCUMENT_DELETED", entityType: "Document", entityId: document.id } });
    });
  } catch {
    return apiError("Storage was cleaned up, but the database deletion needs reconciliation", 503);
  }
  return apiOk({ deleted: true });
}
