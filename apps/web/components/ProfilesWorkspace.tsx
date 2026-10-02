"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { documentRequest } from "../lib/documents-client";
import styles from "./Onboarding.module.css";

type FamilySummary = { id: string; name: string; role: string; counts: { members: number; documents: number; profiles: number } };
type Profile = { id: string; name: string; relationship: string | null; dateOfBirth: string | null; createdAt: string; updatedAt: string; _count: { documents: number } };

export function ProfilesWorkspace({ initialFamilyId = "", initialEditId = "", createOnly = false }: { initialFamilyId?: string; initialEditId?: string; createOnly?: boolean }) {
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [familyId, setFamilyId] = useState(initialFamilyId);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editId, setEditId] = useState(initialEditId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadFamilies = useCallback(async () => {
    try {
      const data = await documentRequest<FamilySummary[]>("/api/families");
      setFamilies(data);
      if (!familyId || !data.some(item => item.id === familyId)) setFamilyId(data[0]?.id ?? "");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Families could not be loaded."); }
  }, [familyId]);
  const loadProfiles = useCallback(async (id: string, signal?: AbortSignal) => {
    if (!id) { setProfiles([]); return; }
    setLoading(true); setError("");
    try { setProfiles(await documentRequest<Profile[]>(`/api/profiles?familyId=${encodeURIComponent(id)}`, { signal })); }
    catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Profiles could not be loaded."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void loadFamilies(); }, [loadFamilies]);
  useEffect(() => {
    const controller = new AbortController();
    void loadProfiles(familyId, controller.signal);
    return () => controller.abort();
  }, [familyId, loadProfiles]);

  const family = families.find(item => item.id === familyId);
  const canManage = Boolean(family && ["OWNER", "ADMIN"].includes(family.role));
  if (error && !families.length) return <div className={styles.error} role="alert"><p>{error}</p><button className="secondary-btn" type="button" onClick={() => { setError(""); void loadFamilies(); }}>Retry</button></div>;
  if (!loading && !families.length) return <div className={styles.panel}><h2>No family access yet</h2><p>Create a Family Space before adding profiles.</p><Link className="primary-btn" href="/family/create">Create Family Space</Link></div>;

  return <div className={styles.page}>
    <label className={styles.field}>Family Space<select value={familyId} onChange={event => { setFamilyId(event.target.value); setEditId(""); }}><option value="" disabled>Choose a family</option>{families.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {canManage ? <ProfileEditor familyId={familyId} editId={editId} profiles={profiles} createOnly={createOnly} onSaved={async message => { setNotice(message); setEditId(""); await loadProfiles(familyId); }} onError={setError} /> : <p className={styles.error} role="alert">Only family owners and admins can manage profiles.</p>}
    {!createOnly && <section className={styles.panel}><div className="block-heading"><h2>Family profiles</h2>{canManage && <Link className="text-link" href={`/profile/create?familyId=${encodeURIComponent(familyId)}`}>Add profile</Link>}</div>{loading ? <p role="status">Loading profiles…</p> : profiles.length ? <ul className={styles.list}>{profiles.map(profile => <li className={styles.item} key={profile.id}><div className={styles.itemMain}><div className={styles.itemTitle}>{profile.name}</div><p className={styles.meta}>{profile.relationship || "Family profile"} · {profile._count.documents} document{profile._count.documents === 1 ? "" : "s"}</p></div>{canManage && <div className={styles.actions}><button className="secondary-btn" type="button" onClick={() => setEditId(profile.id)}>Edit</button><button className="secondary-btn" type="button" disabled={profile._count.documents > 0} title={profile._count.documents > 0 ? "Profiles with documents cannot be deleted" : undefined} onClick={async () => { if (!confirm(`Delete ${profile.name}?`)) return; try { await documentRequest(`/api/profiles/${profile.id}`, { method: "DELETE" }); setNotice("Profile deleted."); await loadProfiles(familyId); } catch (failure) { setError(failure instanceof Error ? failure.message : "Profile could not be deleted."); } }}>Delete</button></div>}</li>)}</ul> : <p>No profiles yet. Add the first person this family organizes documents for.</p>}</section>}
  </div>;
}

function ProfileEditor({ familyId, editId, profiles, createOnly, onSaved, onError }: { familyId: string; editId: string; profiles: Profile[]; createOnly: boolean; onSaved: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const profile = profiles.find(item => item.id === editId);
  const [name, setName] = useState(profile?.name ?? "");
  const [relationship, setRelationship] = useState(profile?.relationship ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(profile?.name ?? ""); setRelationship(profile?.relationship ?? ""); setDateOfBirth(profile?.dateOfBirth?.slice(0, 10) ?? ""); }, [editId, profile?.name, profile?.relationship, profile?.dateOfBirth]);
  if (!createOnly && !editId) return null;

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); onError("");
    try {
      const body = { name, relationship: relationship || undefined, dateOfBirth: dateOfBirth || (editId ? null : undefined) };
      if (editId) await documentRequest(`/api/profiles/${encodeURIComponent(editId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      else await documentRequest(`/api/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ familyId, ...body }) });
      await onSaved(editId ? "Profile updated." : "Profile created.");
      if (!editId) { setName(""); setRelationship(""); setDateOfBirth(""); }
    } catch (failure) { onError(failure instanceof Error ? failure.message : "Profile could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className={styles.panel}><h2>{editId ? "Edit profile" : "Create profile"}</h2><form onSubmit={submit}><div className={styles.grid}><label className={styles.field}>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={80} /></label><label className={styles.field}>Relationship<input value={relationship} onChange={event => setRelationship(event.target.value)} maxLength={40} placeholder="Self, parent, child…" /></label><label className={styles.field}>Date of birth (optional)<input type="date" value={dateOfBirth} onChange={event => setDateOfBirth(event.target.value)} /></label></div><div className={styles.actions}><button type="submit" className="primary-btn" disabled={busy}>{busy ? "Saving…" : editId ? "Save profile" : "Create profile"}</button>{editId && <Link className="secondary-btn" href={`/profiles?familyId=${encodeURIComponent(familyId)}`}>Cancel</Link>}</div></form></section>;
}
