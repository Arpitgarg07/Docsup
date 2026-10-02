import Link from "next/link";
import { JoinCode } from "../../components/JoinCode";
import { getCurrentUser } from "../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function JoinCodePage() {
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Join a Docsup Family Space</h1><p>Sign in with the account that should join the family, then return here to enter the invitation code.</p><Link href="/sign-in?next=/join" className="primary-btn">Sign in to join</Link></main>;
  return <main className="container" style={{ paddingTop: 40 }}><JoinCode /></main>;
}
