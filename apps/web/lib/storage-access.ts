import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const contextSchema = z.object({
  fileId: z.string().min(1).max(128),
  versionId: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
  familyId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
}).strict();
const claimsSchema = contextSchema.extend({
  purpose: z.literal("docsup:download:v1"),
  expiresAt: z.number().int().positive(),
});
export type DownloadContext = z.infer<typeof contextSchema>;
export const MAX_TOKEN_SECONDS = 15 * 60;

function signature(encoded: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-with-")) {
    throw new Error("SESSION_SECRET must be configured with at least 32 random characters");
  }
  return createHmac("sha256", secret).update(`docsup:download:v1.${encoded}`).digest("base64url");
}

export function createStorageAccess(context: DownloadContext, expiresInSeconds: number, now = Date.now()) {
  if (!Number.isFinite(expiresInSeconds)) throw new Error("INVALID_TOKEN_LIFETIME");
  const expiresAt = new Date(now + Math.min(Math.max(expiresInSeconds, 1), MAX_TOKEN_SECONDS) * 1000);
  const claims = { ...contextSchema.parse(context), purpose: "docsup:download:v1", expiresAt: expiresAt.getTime() };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${encoded}.${signature(encoded)}`, expiresAt };
}

export function verifyStorageAccess(token: string, context: Pick<DownloadContext, "userId">, now = Date.now()) {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const [encoded, supplied] = token.split(".");
    const expected = Buffer.from(signature(encoded));
    const received = Buffer.from(supplied);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (claims.expiresAt <= now || claims.expiresAt > now + MAX_TOKEN_SECONDS * 1000) return null;
    if (claims.userId !== context.userId) return null;
    return claims;
  } catch {
    return null;
  }
}
