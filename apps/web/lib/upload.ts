const MAX_BYTES = 25 * 1024 * 1024;
const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

export function validateUpload(file: File) {
  if (!allowed.has(file.type)) throw new Error("UNSUPPORTED_FILE_TYPE");
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error("FILE_SIZE_LIMIT");
  return true;
}

export function objectKey(familyId: string, profileId: string, documentId: string, kind: string, fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `families/${familyId}/profiles/${profileId}/documents/${documentId}/${kind}.${ext}`;
}
