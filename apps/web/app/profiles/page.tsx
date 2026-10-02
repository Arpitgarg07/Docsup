import Link from "next/link";
import { Sidebar } from "../../components/Sidebar";
import { ProfilesWorkspace } from "../../components/ProfilesWorkspace";
import { getCurrentUser } from "../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProfilesPage({ searchParams }: { searchParams: Promise<{ familyId?: string; edit?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Profiles</h1><p>Sign in to manage family profiles.</p><Link href="/sign-in?next=/profiles" className="primary-btn">Sign in</Link></main>;
  const query = await searchParams;
  return <div className="shell"><Sidebar /><main className="workspace"><div className="workspace-top"><div><h1>Profiles</h1><p className="small-muted">People your family organizes documents for.</p></div><Link className="text-link" href="/family">Family Space</Link></div><ProfilesWorkspace initialFamilyId={query.familyId} initialEditId={query.edit} /></main></div>;
}
