-- Appwrite-backed document storage and explicit deletion-reconciliation states.
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'UPLOADED';
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'DELETION_PENDING';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_DELETION_FAILED';

-- Preserve pre-Appwrite rows as legacy records instead of pretending their object
-- keys are Appwrite file IDs. New rows use the Appwrite default.
ALTER TABLE "DocumentVersion"
  ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "storageFileId" TEXT;

UPDATE "DocumentVersion"
SET "storageFileId" = "objectKey"
WHERE "storageFileId" IS NULL;

ALTER TABLE "DocumentVersion"
  ALTER COLUMN "storageFileId" SET NOT NULL,
  ALTER COLUMN "storageProvider" SET DEFAULT 'appwrite';
