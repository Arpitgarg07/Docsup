import Link from "next/link";
import { Sidebar } from "../../components/Sidebar";
import { Documents } from "../../components/Documents";
import { getCurrentUser } from "../../lib/auth";
import { db } from "../../lib/db";
import type { DocumentFamily } from "../../lib/documents-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  let families: DocumentFamily[] = [];
  let error: string | undefined;
  let signInRequired = false;
  try {
    const user = await getCurrentUser();
    if (!user) {
      signInRequired = true;
      error = "Sign in required. Sign in to Docsup to access your family documents.";
    } else {
      // Bootstrap authorized upload/search choices on the server using the
      // existing session and FamilyMember relationship. Document reads and
      // mutations still go through the existing APIs.
      const memberships = await db.familyMember.findMany({
        where: { userId: user.id },
        select: {
          role: true,
          family: { select: {
            id: true, name: true,
            profiles: { select: { id: true, name: true }, orderBy: { name: "asc" } },
            categories: { select: { id: true, name: true }, orderBy: { sortOrder: "asc" } },
          } },
        },
        orderBy: { joinedAt: "asc" },
      });
      families = memberships.map(({ family, role }) => ({ ...family, role }));
    }
  } catch {
    error = "We could not load your authorized families. Please try reloading this page. No document changes were made.";
  }

  return <div className="shell">
    <Sidebar />
    <main className="workspace">
      <div className="workspace-top"><h1>Documents</h1><Link className="text-link" href="/dashboard">Back to dashboard</Link></div>
      <p className="small-muted">Your family’s documents, stored privately.</p>
      <p id="dashboard-availability" className="small-muted">Documents includes real family-scoped search. Family and Profiles provide onboarding; unavailable sidebar areas remain disabled.</p>
      {signInRequired && <p><Link href="/sign-in" className="primary-btn">Sign in to Docsup</Link></p>}
      <Documents families={families} initialError={error} />
    </main>
  </div>;
}
