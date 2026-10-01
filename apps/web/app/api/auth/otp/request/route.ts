import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { apiError, apiOk } from "../../../../../lib/api";
const schema = z.object({ destination: z.string().trim().min(5).max(160) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return apiError("Enter a valid email or phone number", 422);
  const destination = parsed.data.destination.toLowerCase(); const recent = await db.otpChallenge.count({ where: { destination, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } } }); if (recent >= 5) return apiError("Too many requests. Try again later.", 429);
  const code = randomInt(100000, 999999).toString(); await db.otpChallenge.create({ data: { destination, codeHash: createHash("sha256").update(code).digest("hex"), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  // Integrate an OTP provider here. Never return or log the code in production.
  return apiOk({ sent: true, expiresIn: 600 });
}
