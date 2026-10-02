import Link from "next/link";
import { notFound } from "next/navigation";
import { Sidebar } from "../../../components/Sidebar";
import { FamilyWorkspace } from "../../../components/FamilyWorkspace";
import { getCurrentUser } from "../../../lib/auth";
import { db } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FamilyDetailPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const user = await getCurrentUser();
  if (!user) return <main className="container" style={{ paddingTop: 40 }}><h1>Family Space</h1><p>Sign in to view this family.</p><Link href={`/sign-in?next=/family/${encodeURIComponent(familyId)}`} className="primary-btn">Sign in</Link></main>;
  const membership = await db.familyMember.findUnique({ where: { familyId_userId: { familyId, userId: user.id } }, select: { id: true } });
  if (!membership) notFound();
  return <div className="shell"><Sidebar /><main className="workspace"><div className="workspace-top"><h1>Family Space</h1><Link className="text-link" href="/family">All families</Link></div><FamilyWorkspace initialFamilyId={familyId} /></main></div>;
}
