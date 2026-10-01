import "server-only";
import { z } from "zod";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export interface EmailProvider {
  /** Resolves only when the provider accepts the message, not on inbox delivery. */
  send(message: EmailMessage): Promise<void>;
}

export class EmailConfigurationError extends Error {
  constructor() { super("Email sign-in is not configured. No sign-in code was sent."); }
}

const failures = {
  test_recipient_restricted: { status: 403, message: "This test sender can only email the Resend account owner's inbox. Use that email address, or ask the administrator to configure a verified sender domain." },
  sender_not_verified: { status: 503, message: "The sign-in email sender is not verified or authorized. Ask the administrator to verify the sender domain in Resend." },
  credentials_rejected: { status: 503, message: "The email service rejected its server credentials. Ask the administrator to check the Resend API key and sending permissions." },
  recipient_invalid: { status: 422, message: "The email provider rejected the recipient address. Check your email address and try again." },
  request_invalid: { status: 422, message: "The email provider rejected the email request. Check your email address or contact the administrator." },
  sending_not_authorized: { status: 503, message: "Email sending is not authorized. Ask the administrator to check the sender and Resend account permissions." },
  provider_limited: { status: 429, message: "The email service has reached a sending rate or quota limit. Please wait before requesting another code." },
  provider_unavailable: { status: 503, message: "The email service is temporarily unavailable. Please try again later." },
  timeout: { status: 504, message: "The email service timed out. Please try requesting a new code later." },
  dns_failure: { status: 503, message: "The server could not resolve the email service address. Please try again later or contact the administrator." },
  network_failure: { status: 503, message: "The server could not connect to the email service. Please try again later or contact the administrator." },
  invalid_response: { status: 502, message: "The email service returned an unexpected response. Please try again later." },
  challenge_expired: { status: 503, message: "The sign-in request expired before it was ready. Please request a new code." },
} as const;

type EmailFailureReason = keyof typeof failures;
const providerCodes = ["validation_error", "missing_api_key", "invalid_api_key", "restricted_api_key", "suspended_api_key", "invalid_permission", "daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded", "application_error", "service_unavailable", "missing_required_field", "missing_required_parameter", "invalid_parameter", "invalid_idempotency_key", "concurrent_idempotent_requests", "invalid_idempotent_request", "not_found", "method_not_allowed"] as const;
type ProviderCode = typeof providerCodes[number] | "unknown";

export class EmailDeliveryError extends Error {
  readonly status: number;
  constructor(readonly reason: EmailFailureReason = "provider_unavailable", readonly upstreamStatus: number | null = null, readonly providerCode: ProviderCode = "unknown") {
    super(failures[reason].message);
    this.status = failures[reason].status;
  }
}

// Raw provider bodies may contain recipients, credentials or reflected message
// content. Inspect them only in memory, and return fixed allowlisted diagnostics.
function providerFailure(status: number, payload: unknown): EmailDeliveryError {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const name = typeof body.name === "string" && providerCodes.some(code => code === body.name) ? body.name as ProviderCode : "unknown";
  const message = typeof body.message === "string" ? body.message.toLowerCase() : "";
  let reason: EmailFailureReason;
  if (status === 403 && message.includes("only send testing emails to your own email")) reason = "test_recipient_restricted";
  else if (status === 401 || ["missing_api_key", "invalid_api_key", "restricted_api_key", "suspended_api_key", "invalid_permission"].includes(name) || (status === 403 && /api key.*(invalid|expired|disabled|not active|suspended)/.test(message))) reason = "credentials_rejected";
  else if (status === 429) reason = "provider_limited";
  else if (status >= 500) reason = "provider_unavailable";
  else if ((message.includes("domain") && message.includes("not verified")) || ([400, 422].includes(status) && /invalid\s+[`'"]?(?:from|sender)\b|\b(?:from|sender)\b.{0,80}\b(?:invalid|not valid|not verified|not authorized)\b/.test(message))) reason = "sender_not_verified";
  else if (status === 403) reason = "sending_not_authorized";
  else if ([400, 422].includes(status) && /invalid\s+[`'"]?(?:to|recipient)\b|\b(?:to|recipient)\b.{0,80}\b(?:invalid|not valid)\b/.test(message)) reason = "recipient_invalid";
  else if ([400, 422].includes(status)) reason = "request_invalid";
  else if (status === 409) reason = "provider_unavailable";
  else reason = "invalid_response";
  return new EmailDeliveryError(reason, status, name);
}

export function isEmailConfigured() {
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  const address = from?.match(/^[^<>\r\n]*<([^<>\s]+)>$/)?.[1] ?? from;
  return Boolean(process.env.RESEND_API_KEY?.trim() && from && !/[\r\n]/.test(from) && z.email().safeParse(address).success);
}

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(message: EmailMessage): Promise<void> {
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw providerFailure(response.status, payload);
      }
      let result: unknown;
      try { result = await response.json(); }
      catch { throw new EmailDeliveryError(signal.aborted ? "timeout" : "invalid_response", response.status); }
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) throw new EmailDeliveryError("invalid_response", response.status);
    } catch (error) {
      // Preserve classified provider failures; never wrap away their HTTP status.
      if (error instanceof EmailDeliveryError) throw error;
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as Record<string, unknown> : {};
      if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(String(cause.code))) throw new EmailDeliveryError("timeout");
      if (["ENOTFOUND", "EAI_AGAIN"].includes(String(cause.code))) throw new EmailDeliveryError("dns_failure");
      throw new EmailDeliveryError("network_failure");
    }
  }
}

export function getEmailProvider(): EmailProvider {
  if (!isEmailConfigured()) throw new EmailConfigurationError();
  return new ResendEmailProvider(process.env.RESEND_API_KEY!.trim(), process.env.AUTH_EMAIL_FROM!.trim());
}
