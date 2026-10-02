"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { documentRequest } from "../lib/documents-client";
import styles from "./Onboarding.module.css";

type FamilySummary = { id: string; name: string; role: string; counts: { members: number; documents: number; profiles: number } };
type FamilyDetail = {
  id: string; name: string; approvalMode: string; createdAt: string; updatedAt: string; viewerRole: string;
  members: { id: string; role: string; joinedAt: string; user: { id: string; name: string | null; email: string | null; phone: string | null } }[];
  profiles: { id: string; name: string; relationship: string | null; dateOfBirth: string | null; _count: { documents: number } }[];
  categories: { id: string; name: string; slug: string; system: boolean; sortOrder: number }[];
  invites?: Invitation[];
};
type Invitation = { id: string; email: string | null; role: string; expiresAt: string; revokedAt: string | null; acceptedAt: string | null };
const dateLabel = (value: string) => new Date(value).toLocaleString();
const activeInvite = (invite: Invitation) => !invite.revokedAt && !invite.acceptedAt && new Date(invite.expiresAt) > new Date();

export function FamilyWorkspace({ initialFamilyId = "" }: { initialFamilyId?: string }) {
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [familyId, setFamilyId] = useState(initialFamilyId);
  const [detail, setDetail] = useState<FamilyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadFamilies = useCallback(async (signal?: AbortSignal) => {
    const data = await documentRequest<FamilySummary[]>("/api/families", { signal });
    setFamilies(data);
    setFamilyId(current => current && data.some(item => item.id === current) ? current : data[0]?.id ?? "");
  }, []);
  const loadDetail = useCallback(async (id: string, signal?: AbortSignal) => {
    if (!id) { setDetail(null); return; }
    setError("");
    setDetail(await documentRequest<FamilyDetail>(`/api/families/${encodeURIComponent(id)}`, { signal }));
  }, []);
  const refresh = useCallback(() => {
    void loadFamilies().catch(failure => setError(failure instanceof Error ? failure.message : "Families could not be loaded."));
    void loadDetail(familyId).catch(failure => setError(failure instanceof Error ? failure.message : "Family details could not be loaded."));
  }, [familyId, loadDetail, loadFamilies]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadFamilies(controller.signal).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Families could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadFamilies]);
  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(familyId, controller.signal).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Family details could not be loaded.");
    });
    return () => controller.abort();
  }, [familyId, loadDetail]);

  if (loading) return <p role="status">Loading your family spaces…</p>;
  if (error && !families.length) return <div className={styles.error} role="alert"><p>{error}</p><button type="button" className="secondary-btn" onClick={refresh}>Retry</button></div>;
  if (!families.length) return <div className={styles.panel}><h2>Create your first Family Space</h2><p>Your account has no family membership yet. Create a private family space to add profiles and upload documents.</p><div className={styles.actions}><Link className="primary-btn" href="/family/create">Create Family Space</Link><Link className="secondary-btn" href="/join">Join with a code</Link></div></div>;

  return <div className={styles.page}>
    <section className={styles.panel}><div className="block-heading"><h2>Your Family Spaces</h2><span className="small-muted">{families.length} space{families.length === 1 ? "" : "s"}</span></div><ul className={styles.list}>{families.map(family => <li className={styles.item} key={family.id}><div className={styles.itemMain}><div className={styles.itemTitle}>{family.name}</div><p className={styles.meta}>{family.role} · {family.counts.members} member{family.counts.members === 1 ? "" : "s"} · {family.counts.profiles} profile{family.counts.profiles === 1 ? "" : "s"} · {family.counts.documents} document{family.counts.documents === 1 ? "" : "s"}</p></div><button className="secondary-btn" type="button" onClick={() => setFamilyId(family.id)}>{family.id === familyId ? "Selected" : "Open"}</button></li>)}</ul></section>
    <label className={styles.field}>Selected Family Space<select value={familyId} onChange={event => setFamilyId(event.target.value)}><option value="" disabled>Choose a family</option>{families.map(family => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>
    <div className={styles.actions}><Link className="secondary-btn" href="/family/create">Create another family</Link><Link className="secondary-btn" href="/join">Join with a code</Link></div>
    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" className="secondary-btn" onClick={refresh}>Retry</button></div>}
    {detail?.id === familyId ? <FamilyDetailView key={familyId} detail={detail} onChanged={refresh} /> : !error && <p role="status">Loading family details…</p>}
  </div>;
}

function FamilyDetailView({ detail, onChanged }: { detail: FamilyDetail; onChanged: () => void }) {
  const canManage = ["OWNER", "ADMIN"].includes(detail.viewerRole);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteResult, setInviteResult] = useState<{ code: string; link: string } | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createInvite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await documentRequest<{ code: string; link: string }>(`/api/families/${detail.id}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: inviteRole }) });
      setInviteResult(result); setInviteEmail(""); setMessage("Invitation created. No email was sent; copy the secure link or code to the intended person."); onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Invitation could not be created."); }
    finally { setBusy(false); }
  }

  async function revokeInvite(id: string) {
    setBusy(true); setError("");
    try { await documentRequest(`/api/families/${detail.id}/invite?inviteId=${encodeURIComponent(id)}`, { method: "DELETE" }); setMessage("Invitation revoked."); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Invitation could not be revoked."); }
    finally { setBusy(false); }
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await documentRequest(`/api/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ familyId: detail.id, name: categoryName }) }); setCategoryName(""); setMessage("Category created."); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Category could not be created."); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage("Copied to clipboard."); }
    catch { setMessage("Copy was unavailable. Select and copy the value manually."); }
  }

  return <>
    {message && <p className={styles.notice} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={styles.panel}><div className="block-heading"><div><h2>{detail.name}</h2><p className="small-muted">{detail.approvalMode.replaceAll("_", " ")} · {detail.members.length} member{detail.members.length === 1 ? "" : "s"}</p></div><Link className="text-link" href={`/documents?familyId=${encodeURIComponent(detail.id)}`}>Open documents</Link></div><p className="small-muted">Your family data is scoped by membership. Only owners/admins can manage members, profiles and categories.</p></section>

    <section className={styles.panel}><h2>Family members</h2><ul className={styles.list}>{detail.members.map(member => <li className={styles.item} key={member.id}><div className={styles.itemMain}><div className={styles.itemTitle}>{member.user.name || member.user.email || member.user.phone || "Unnamed member"}</div><p className={styles.meta}>{member.user.email || member.user.phone || "No contact address"} · Joined {dateLabel(member.joinedAt)}</p></div><span className={styles.badge}>{member.role}</span></li>)}</ul></section>

    {canManage && <section className={styles.panel}><h2>Invite a family member</h2><p className="small-muted">MVP invitations are copyable links/codes. No invitation email is sent by this flow.</p><form onSubmit={createInvite}><div className={styles.grid}><label className={styles.field}>Email (optional)<input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="member@example.com" /></label><label className={styles.field}>Role<select value={inviteRole} onChange={event => setInviteRole(event.target.value)}><option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="UPLOADER">Uploader</option><option value="VIEWER">Viewer</option></select></label></div><div className={styles.actions}><button className="primary-btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create invitation"}</button></div></form>{inviteResult && <div className={styles.copy}><input aria-label="Invite link" readOnly value={inviteResult.link} /><button className="secondary-btn" type="button" onClick={() => void copy(inviteResult.link)}>Copy link</button><input aria-label="Invite code" readOnly value={inviteResult.code} /><button className="secondary-btn" type="button" onClick={() => void copy(inviteResult.code)}>Copy code</button></div>}<ul className={styles.list}>{(detail.invites ?? []).filter(activeInvite).map(invite => <li className={styles.item} key={invite.id}><div className={styles.itemMain}><div className={styles.itemTitle}>{invite.email || "Open invitation"}</div><p className={styles.meta}>{invite.role} · expires {dateLabel(invite.expiresAt)}</p></div><button className="secondary-btn" type="button" disabled={busy} onClick={() => void revokeInvite(invite.id)}>Revoke</button></li>)}</ul></section>}

    <section className={styles.panel}><div className="block-heading"><h2>Profiles</h2>{canManage && <Link className="text-link" href={`/profile/create?familyId=${encodeURIComponent(detail.id)}`}>Add profile</Link>}</div><ul className={styles.list}>{detail.profiles.map(profile => <li className={styles.item} key={profile.id}><div className={styles.itemMain}><div className={styles.itemTitle}>{profile.name}</div><p className={styles.meta}>{profile.relationship || "Family profile"} · {profile._count.documents} document{profile._count.documents === 1 ? "" : "s"}</p></div>{canManage && <Link className="secondary-btn" href={`/profiles?familyId=${encodeURIComponent(detail.id)}&edit=${encodeURIComponent(profile.id)}`}>Edit</Link>}</li>)}</ul></section>

    <section className={styles.panel}><h2>Categories</h2><ul className={styles.list}>{detail.categories.map(category => <li className={styles.item} key={category.id}><div className={styles.itemMain}><div className={styles.itemTitle}>{category.name}</div><p className={styles.meta}>{category.system ? "System category" : "Family category"}</p></div></li>)}</ul>{canManage && <form onSubmit={createCategory}><div className={styles.actions}><label className={styles.field} style={{ flex: 1 }}>New category<input value={categoryName} onChange={event => setCategoryName(event.target.value)} required maxLength={60} /></label><button className="secondary-btn" type="submit" disabled={busy}>Add category</button></div></form>}</section>
  </>;
}
