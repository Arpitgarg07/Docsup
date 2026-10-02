"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import styles from "./SignIn.module.css";

async function postAuth<T>(url: string, data: Record<string, string>): Promise<T> {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error?.message === "string" ? body.error.message : `Sign-in request failed (${response.status}). Please try again.`);
  if (!body?.data) throw new Error("Unexpected sign-in response. Please try again.");
  return body.data as T;
}

export function SignIn({ googleEnabled, emailEnabled, redirectTo = "/dashboard", sessionError }: { googleEnabled: boolean; emailEnabled: boolean; redirectTo?: string; sessionError?: string }) {
  const router = useRouter();
  const [destination, setDestination] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"request" | "verify" | null>(null);
  const [error, setError] = useState(sessionError ?? "");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>, action: "request" | "verify") {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError("");
    setNotice("");
    const normalized = destination.trim().toLowerCase();
    try {
      if (normalized.length < 5 || normalized.length > 160 || !normalized.includes("@")) throw new Error("Enter your email address first.");
      if (action === "request") {
        const result = await postAuth<{ sent: boolean; expiresIn: number }>("/api/auth/otp/request", { destination: normalized });
        if (result.sent !== true) throw new Error("The server did not confirm code delivery.");
        setNotice(`Your sign-in email was accepted for sending. Check your inbox and spam folder. The code expires in ${Math.ceil(result.expiresIn / 60)} minutes.`);
      } else {
        if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code you received.");
        const result = await postAuth<{ authenticated: boolean }>("/api/auth/otp/verify", { destination: normalized, code });
        if (result.authenticated !== true) throw new Error("The server did not confirm authentication.");
        setCode("");
        // The server sets the HttpOnly cookie. Do not read/store tokens in JS.
        // Refresh invalidates previously visited signed-out server-component data.
        router.replace(redirectTo as Route);
        router.refresh();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in could not be completed. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return <div className={styles.card}>
    <h1>Sign in to Docsup</h1>
    <p>Sign in with a six-digit code sent to your email. Do not share your code with anyone.</p>
    {!emailEnabled && <p className={styles.warning}>Email sign-in is not configured yet. Ask the administrator to configure the server-side email provider. No local bypass code is available.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <form onSubmit={event => void submit(event, "request")}>
      <fieldset disabled={busy !== null}>
        <legend>Request a sign-in code</legend>
        <label htmlFor="sign-in-destination">Email address</label>
        <input id="sign-in-destination" name="destination" type="email" autoComplete="username" required minLength={5} maxLength={160} value={destination} onChange={event => { setDestination(event.target.value); setCode(""); setNotice(""); setError(""); }} />
        <button type="submit" className="primary-btn">{busy === "request" ? "Requesting…" : "Request code"}</button>
      </fieldset>
    </form>
    <form onSubmit={event => void submit(event, "verify")}>
      <fieldset disabled={busy !== null}>
        <legend>Verify a code you already received</legend>
        <p className="small-muted">Use the same email address as the code request. Verification does not send or generate a code.</p>
        <label htmlFor="sign-in-code">Six-digit code</label>
        <input id="sign-in-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={event => setCode(event.target.value)} />
        <button type="submit" className="primary-btn">{busy === "verify" ? "Signing in…" : "Verify and sign in"}</button>
      </fieldset>
    </form>
    {googleEnabled ? <a href="/api/auth/google" className="secondary-btn">Continue with Google</a> : <p className="small-muted">Google sign-in is also unavailable: client credentials are not configured.</p>}
  </div>;
}
