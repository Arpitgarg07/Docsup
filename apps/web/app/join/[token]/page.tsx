import Link from "next/link";
import { JoinInvite } from "../../../components/JoinInvite";
import { getCurrentUser } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Join a Docsup Family Space</h1><p>Sign in with the email address that should receive this invitation, then return here to accept it.</p><Link href={`/sign-in?next=/join/${encodeURIComponent(token)}`} className="primary-btn">Sign in to accept</Link></main>;
  return <main className="container" style={{ paddingTop: 40 }}><JoinInvite token={token} /></main>;
}
