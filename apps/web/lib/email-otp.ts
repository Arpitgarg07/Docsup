import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { apiError, apiOk } from "./api";
import { EmailConfigurationError, EmailDeliveryError, getEmailProvider } from "./email";

const schema = z.object({ destination: z.string().trim().max(160).pipe(z.email()).transform(value => value.toLowerCase()) });
export const OTP_LIFETIME_SECONDS = 600;
export const OTP_REQUEST_LIMIT = 5;
class RequestLimitError extends Error {}

export async function requestEmailOtp(request: Request) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return apiError("Enter a valid email address", 422);

  try {
    const provider = getEmailProvider();
    const destination = input.data.destination;
    // Same secure generation and SHA-256 representation as the existing flow.
    const code = randomInt(100000, 999999).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_LIFETIME_SECONDS * 1000);
    const codeHash = createHash("sha256").update(code).digest("hex");
    const lockKey = createHash("sha256").update(`docsup:email-otp:${destination}`).digest().readBigInt64BE();

    const challenge = await db.$transaction(async tx => {
      // PostgreSQL transaction-local lock prevents parallel requests bypassing
      // the existing five-per-address/ten-minute quota. No Redis required.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
      const recent = await tx.otpChallenge.count({ where: { destination, createdAt: { gt: new Date(Date.now() - OTP_LIFETIME_SECONDS * 1000) } } });
      if (recent >= OTP_REQUEST_LIMIT) throw new RequestLimitError();
      // Fail closed: verification ignores consumed challenges. Enable this row
      // only after provider acceptance. Failures/crashes remain unverifiable and
      // still count toward the request quota; no plaintext is persisted.
      return tx.otpChallenge.create({ data: { destination, codeHash, expiresAt, consumedAt: now } });
    });

    const expiration = `${expiresAt.toISOString().replace("T", " ").replace(".000Z", "Z")} (UTC)`;
    await provider.send({
      to: destination,
      subject: "Your Docsup sign-in code",
      text: `Docsup\n\nYour Docsup sign-in code is: ${code}\n\nThis code expires in 10 minutes, at ${expiration}.\nDo not share this code with anyone. Docsup will never ask you to share it.\nIf you did not request this code, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;color:#182321"><strong>Docsup</strong><h1>Your Docsup sign-in code</h1><p style="font-size:28px;letter-spacing:6px"><strong>${code}</strong></p><p>This code expires in 10 minutes, at ${expiration}.</p><p>Do not share this code with anyone. Docsup will never ask you to share it.</p><p>If you did not request this code, ignore this email.</p></div>`,
      idempotencyKey: `docsup-otp-${challenge.id}`,
    });

    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
      if (expiresAt.getTime() <= Date.now()) throw new EmailDeliveryError("challenge_expired");
      // The most recently activated accepted request replaces prior active codes. Pending
      // or failed sends cannot authenticate, even if provider delivery is delayed.
      await tx.otpChallenge.updateMany({ where: { destination, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: null } });
    });
    return apiOk({ sent: true, expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) });
  } catch (error) {
    if (error instanceof RequestLimitError) return apiError("Too many requests. Try again later.", 429);
    if (error instanceof EmailConfigurationError) return apiError(error.message, 503);
    if (error instanceof EmailDeliveryError) {
      const requestId = randomUUID();
      // Fixed categories/statuses only. Never log the Error object, raw provider
      // body, recipient, request headers, email content, OTP, or environment values.
      console.warn("[auth.email.delivery_failed]", {
        requestId,
        provider: "resend",
        reason: error.reason,
        upstreamStatus: error.upstreamStatus,
        providerCode: error.providerCode,
        applicationStatus: error.status,
      });
      return apiError(error.message, error.status, requestId);
    }
    // No database stack traces, provider responses, email bodies or keys escape.
    return apiError("Email sign-in is temporarily unavailable. Please try again later.", 503);
  }
}
