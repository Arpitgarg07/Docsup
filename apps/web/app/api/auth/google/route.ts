import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID; const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  if (!clientId) return NextResponse.json({ error: { message: "Google sign-in is not configured" } }, { status: 503 });
  const state = randomBytes(24).toString("base64url"); const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${appUrl}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", state, access_type: "online", prompt: "select_account" });
  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`); response.cookies.set("docsup_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" }); return response;
}
