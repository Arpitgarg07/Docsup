import Link from "next/link";
import { Sidebar } from "../../components/Sidebar";
import { FamilyWorkspace } from "../../components/FamilyWorkspace";
import { getCurrentUser } from "../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Family Space</h1><p>Sign in to manage your family spaces.</p><Link href="/sign-in?next=/family" className="primary-btn">Sign in</Link></main>;
  return <div className="shell"><Sidebar /><main className="workspace"><div className="workspace-top"><div><h1>Family Space</h1><p className="small-muted">Manage members, invitations, profiles and categories.</p></div><Link className="text-link" href="/dashboard">Back to dashboard</Link></div><FamilyWorkspace /></main></div>;
}
