import { requestEmailOtp } from "../../../../../lib/email-otp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return requestEmailOtp(request);
}
