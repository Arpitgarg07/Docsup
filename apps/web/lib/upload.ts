import { createHash } from "node:crypto";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function signatureMatches(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "application/pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  if (mimeType === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/webp") return bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.slice(8, 12).every((byte, index) => byte === [0x57, 0x45, 0x42, 0x50][index]);
  if (mimeType === "application/msword") return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  return false;
}

export async function validateUpload(file: File) {
  if (!allowed.has(file.type)) throw new Error("UNSUPPORTED_FILE_TYPE");
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new Error("FILE_SIZE_LIMIT");
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!signatureMatches(header, file.type)) throw new Error("FILE_SIGNATURE_MISMATCH");
  return true;
}

export function objectKey(familyId: string, profileId: string, documentId: string, kind: string, fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `families/${familyId}/profiles/${profileId}/documents/${documentId}/${kind}.${ext}`;
}

export function checksum(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}
