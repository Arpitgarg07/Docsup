"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { documentRequest } from "../lib/documents-client";
import styles from "./Onboarding.module.css";

export function JoinInvite({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    setBusy(true); setError("");
    try { const result = await documentRequest<{ familyId: string }>("/api/families/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); router.replace(`/family/${result.familyId}`); router.refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Invitation could not be accepted."); setBusy(false); }
  }
  return <div className={styles.panel}><h1>Join a Docsup Family Space</h1><p>Accept this invitation to join the family with the role assigned by its owner or admin.</p>{error && <p className={styles.error} role="alert">{error}</p>}<button type="button" className="primary-btn" disabled={busy} onClick={() => void accept()}>{busy ? "Joining…" : "Accept invitation"}</button></div>;
}
