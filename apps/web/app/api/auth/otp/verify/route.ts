import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { createSession } from "../../../../../lib/auth";
import { apiError, apiOk } from "../../../../../lib/api";
const schema = z.object({ destination: z.string().trim().min(5).max(160), code: z.string().regex(/^\d{6}$/) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("Invalid verification code", 422);
  const destination = parsed.data.destination.toLowerCase(); const challenge = await db.otpChallenge.findFirst({ where: { destination, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!challenge || challenge.attempts >= 5) return apiError("Code expired or unavailable", 401);
  const codeHash = createHash("sha256").update(parsed.data.code).digest("hex");
  if (codeHash !== challenge.codeHash) { await db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } }); return apiError("Incorrect code", 401); }
  const user = challenge.userId ? await db.user.findUnique({ where: { id: challenge.userId } }) : (destination.includes("@") ? await db.user.upsert({ where: { email: destination }, update: {}, create: { email: destination } }) : await db.user.upsert({ where: { phone: destination }, update: {}, create: { phone: destination } }));
  if (!user) return apiError("Account unavailable", 401);
  await db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date(), userId: user.id } }); await createSession(user.id); return apiOk({ authenticated: true });
}
