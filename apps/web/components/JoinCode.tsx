"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { documentRequest } from "../lib/documents-client";
import styles from "./Onboarding.module.css";

export function JoinCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    setBusy(true); setError("");
    try { const result = await documentRequest<{ familyId: string }>("/api/families/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim().toUpperCase() }) }); router.replace(`/family/${result.familyId}`); router.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Invitation could not be accepted."); setBusy(false); }
  }
  return <form className={styles.panel} onSubmit={event => { event.preventDefault(); void accept(); }}><h1>Join a Family Space</h1><p>Enter the one-time invitation code shared by the family owner or admin.</p>{error && <p className={styles.error} role="alert">{error}</p>}<label className={styles.field}>Invitation code<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="DOC-ABCDEF0123456789..." pattern="DOC-[A-F0-9]{32}" required maxLength={36} /></label><div className={styles.actions}><button type="submit" className="primary-btn" disabled={busy}>{busy ? "Joining…" : "Accept invitation"}</button></div></form>;
}
