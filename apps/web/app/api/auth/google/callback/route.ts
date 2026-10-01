import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "../../../../../lib/db";
import { createSession } from "../../../../../lib/auth";
export async function GET(request: Request) {
  const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code"); const expected = (await cookies()).get("docsup_oauth_state")?.value;
  if (!state || !code || !expected || state !== expected) return NextResponse.json({ error: "Invalid OAuth response" }, { status: 400 });
  const token = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`, grant_type: "authorization_code" }) }).then(r => r.ok ? r.json() : null) as { access_token?: string } | null;
  if (!token?.access_token) return NextResponse.json({ error: "Google sign-in failed" }, { status: 401 });
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } }).then(r => r.ok ? r.json() : null) as { sub?: string; email?: string; name?: string; picture?: string } | null;
  if (!info?.sub || !info.email) return NextResponse.json({ error: "Google profile unavailable" }, { status: 401 });
  const user = await db.user.upsert({ where: { email: info.email }, update: { name: info.name, image: info.picture }, create: { email: info.email, name: info.name, image: info.picture } }); await createSession(user.id);
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
