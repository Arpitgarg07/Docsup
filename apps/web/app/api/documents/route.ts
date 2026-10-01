import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../../lib/db";
import { getCurrentUser } from "../../../lib/auth";
import { apiError, apiOk } from "../../../lib/api";
import { getStorageProvider } from "../../../lib/storage";
import { checksum, objectKey, validateUpload } from "../../../lib/upload";

export const runtime = "nodejs";
const querySchema = z.object({ familyId: z.string().min(1), q: z.string().trim().max(120).optional(), status: z.enum(["PROCESSING", "UPLOADED", "PENDING_APPROVAL", "APPROVED", "VERIFIED", "REJECTED", "ARCHIVED"]).optional(), profileId: z.string().optional(), categoryId: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });
const uploadSchema = z.object({ familyId: z.string().min(1), profileId: z.string().min(1), categoryId: z.string().min(1), title: z.string().trim().min(1).max(120), documentType: z.string().trim().min(1).max(80), sensitive: z.enum(["true", "false"]).default("true"), enhanceWithAI: z.enum(["true", "false"]).default("false") });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const input = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return apiError("Invalid document filters", 422);
  const { familyId, q, status, profileId, categoryId, page, pageSize } = input.data;
  const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId, userId: user.id } } });
  if (!membership) return apiError("Family not found", 404);
  const where: Prisma.DocumentWhereInput = { familyId, status: status ?? { notIn: ["DRAFT", "UPLOADING", "DELETED", "DELETION_PENDING"] }, ...(profileId ? { profileId } : {}), ...(categoryId ? { categoryId } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { documentType: { contains: q, mode: "insensitive" } }] } : {}) };
  const [items, total] = await Promise.all([db.document.findMany({ where, include: { profile: { select: { name: true } }, category: { select: { name: true } }, versions: { select: { kind: true, fileName: true, mimeType: true, byteSize: true }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), db.document.count({ where })]);
  return apiOk({ items: items.map((item) => ({ ...item, versions: item.versions.map((version) => ({ ...version, byteSize: Number(version.byteSize) })) })), page, pageSize, total, pages: Math.ceil(total / pageSize) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("Authentication required", 401);
  const form = await request.formData().catch(() => null);
  if (!form) return apiError("Invalid upload request", 422);
  const parsed = uploadSchema.safeParse(Object.fromEntries(form));
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return apiError("Choose a valid document and its family details", 422);
  const { familyId, profileId, categoryId } = parsed.data;
  const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId, userId: user.id } } });
  if (!membership || membership.role === "VIEWER") return apiError("You cannot upload to this family", 403);
  const [profile, category] = await Promise.all([db.profile.findFirst({ where: { id: profileId, familyId } }), db.category.findFirst({ where: { id: categoryId, familyId } })]);
  if (!profile || !category) return apiError("Profile or category not found", 404);
  try {
    await validateUpload(file);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_FILE";
    const messages: Record<string, string> = { UNSUPPORTED_FILE_TYPE: "This file type is not supported.", FILE_SIZE_LIMIT: "Files must be at most 25 MB.", FILE_SIGNATURE_MISMATCH: "The file contents do not match its declared type." };
    return apiError(messages[code] ?? "The file could not be validated.", 422);
  }
  let storage;
  try { storage = getStorageProvider(); } catch { return apiError("Private storage is not configured", 503); }
  const documentId = randomUUID();
  const fileId = randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = objectKey(familyId, profileId, documentId, "original", file.name);
  // Persist the intended file ID BEFORE the external upload, including multipart failures.
  // This leaves a recoverable cleanup target even if upload/finalization is interrupted.
  await db.document.create({ data: { id: documentId, familyId, profileId, categoryId, uploadedById: user.id, title: parsed.data.title, documentType: parsed.data.documentType, sensitive: parsed.data.sensitive === "true", status: "UPLOADING", versions: { create: { kind: "ORIGINAL", objectKey: key, storageProvider: "appwrite", storageFileId: fileId, fileName: file.name, mimeType: file.type, byteSize: BigInt(bytes.byteLength), checksum: checksum(bytes) } } } });
  try {
    await storage.upload({ fileId, body: bytes, fileName: file.name, mimeType: file.type, objectKey: key });
    const { approvalMode } = await db.family.findUniqueOrThrow({ where: { id: familyId }, select: { approvalMode: true } });
    const approvalRequired = approvalMode === "EVERY_UPLOAD" || (approvalMode === "SENSITIVE_ONLY" && parsed.data.sensitive === "true");
    const status = approvalRequired ? "PENDING_APPROVAL" : "APPROVED";
    await db.$transaction(async (tx) => {
      const result = await tx.document.updateMany({ where: { id: documentId, status: "UPLOADING" }, data: { status } });
      if (result.count !== 1) throw new Error("UPLOAD_STATE_CHANGED");
      if (parsed.data.enhanceWithAI === "true") await tx.aIProcessingJob.create({ data: { documentId, task: "ocr_and_metadata", status: "QUEUED" } });
      await tx.auditLog.create({ data: { userId: user.id, familyId, action: "DOCUMENT_UPLOADED", entityType: "Document", entityId: documentId, metadata: { mimeType: file.type, byteSize: file.size, aiRequested: parsed.data.enhanceWithAI === "true" } } });
    });
    return apiOk({ id: documentId, status, processingQueued: parsed.data.enhanceWithAI === "true" }, 201);
  } catch {
    // Deny reads before cleanup. If DB/storage is unavailable, the saved version ID
    // and UPLOADING/DELETION_PENDING state allow operator reconciliation.
    try {
      await db.document.update({ where: { id: documentId }, data: { status: "DELETION_PENDING" } });
      await storage.delete(fileId);
      await db.$transaction(async (tx) => {
        await tx.document.update({ where: { id: documentId }, data: { status: "DELETED" } });
        await tx.auditLog.create({ data: { userId: user.id, familyId, action: "DOCUMENT_DELETED", entityType: "Document", entityId: documentId, metadata: { reason: "UPLOAD_ROLLBACK" } } });
      });
    } catch {
      await db.auditLog.create({ data: { userId: user.id, familyId, action: "DOCUMENT_DELETION_FAILED", severity: "SECURITY_EVENT", entityType: "Document", entityId: documentId, metadata: { reason: "UPLOAD_ROLLBACK" } } }).catch(() => console.error("UPLOAD_RECONCILIATION_REQUIRED"));
      return apiError("Upload failed; cleanup requires retry or reconciliation", 503);
    }
    return apiError("The document could not be stored. Nothing was approved.", 503);
  }
}
