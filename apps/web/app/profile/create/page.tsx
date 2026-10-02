import Link from "next/link";
import { Sidebar } from "../../../components/Sidebar";
import { ProfilesWorkspace } from "../../../components/ProfilesWorkspace";
import { getCurrentUser } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProfileCreatePage({ searchParams }: { searchParams: Promise<{ familyId?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Create profile</h1><p>Sign in to create a family profile.</p><Link href="/sign-in?next=/profile/create" className="primary-btn">Sign in</Link></main>;
  const query = await searchParams;
  return <div className="shell"><Sidebar /><main className="workspace"><div className="workspace-top"><h1>Create profile</h1><Link className="text-link" href="/profiles">Back to profiles</Link></div><ProfilesWorkspace initialFamilyId={query.familyId} createOnly /></main></div>;
}
