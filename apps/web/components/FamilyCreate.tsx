"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { documentRequest } from "../lib/documents-client";
import styles from "./Onboarding.module.css";

export function FamilyCreate() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const family = await documentRequest<{ id: string }>("/api/families", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      router.replace(`/family/${family.id}`);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Family could not be created."); setBusy(false); }
  }

  return <form className={styles.panel} onSubmit={submit}>
    <h2>Create a Family Space</h2>
    <p className="small-muted">You will become the owner of this private family space. Default categories are created once with the family.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <label className={styles.field}>Family name<input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={80} placeholder="e.g. Garg Family" /></label>
    <div className={styles.actions}><button className="primary-btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create Family Space"}</button></div>
  </form>;
}
