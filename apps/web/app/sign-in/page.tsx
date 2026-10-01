import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "../../components/Brand";
import { SignIn } from "../../components/SignIn";
import { getCurrentUser } from "../../lib/auth";
import { isEmailConfigured } from "../../lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  let signedIn = false;
  let sessionError: string | undefined;
  try { signedIn = Boolean(await getCurrentUser()); }
  catch { sessionError = "We could not check your session. The authentication database may be unavailable. Please try again."; }
  if (signedIn) redirect("/dashboard");

  return <main className="container" style={{ paddingTop: 28 }}>
    <Brand />
    <SignIn googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} emailEnabled={isEmailConfigured()} sessionError={sessionError} />
    <p style={{ textAlign: "center" }}><Link href="/dashboard" className="text-link">View demo dashboard without signing in</Link></p>
  </main>;
}
