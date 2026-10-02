import Link from "next/link";
import { Sidebar } from "../../../components/Sidebar";
import { FamilyCreate } from "../../../components/FamilyCreate";
import { getCurrentUser } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FamilyCreatePage() {
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Create Family Space</h1><p>Sign in before creating a family space.</p><Link href="/sign-in?next=/family/create" className="primary-btn">Sign in</Link></main>;
  return <div className="shell"><Sidebar /><main className="workspace"><div className="workspace-top"><h1>Create Family Space</h1><Link className="text-link" href="/family">Back to family</Link></div><FamilyCreate /></main></div>;
}
