"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "./icons";
import { documentRequest, fileSize, responseError, statusLabel, type DocumentFamily, type DocumentPage, type DocumentSummary } from "../lib/documents-client";
import styles from "./Documents.module.css";

const downloadStatuses = new Set(["APPROVED", "VERIFIED", "ARCHIVED"]);
const messageOf = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed. Please try again.";
const dateLabel = (value: string) => new Date(value).toLocaleString();

export function Documents({ families, initialError }: { families: DocumentFamily[]; initialError?: string }) {
  const router = useRouter();
  const [familyId, setFamilyId] = useState(families[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const family = families.find(item => item.id === familyId) ?? families[0];

  if (initialError) return <div className={styles.panel}><p role="alert">{initialError}</p><button type="button" className="secondary-btn" onClick={() => router.refresh()}>Try again</button></div>;
  if (!family) return <div className={styles.panel}><h2>No family access yet</h2><p>You need an existing family membership to view or upload documents.</p><Link href="/family/create" className="primary-btn">Create Family Space</Link></div>;

  return <div className={styles.documents}>
    <label className={styles.family}>Family
      <select value={family.id} disabled={busy} onChange={event => setFamilyId(event.target.value)}>
        {families.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <FamilyDocuments key={family.id} family={family} onBusyChange={setBusy} />
  </div>;
}

function FamilyDocuments({ family, onBusyChange }: { family: DocumentFamily; onBusyChange: (busy: boolean) => void }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [profileFilter, setProfileFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [result, setResult] = useState<DocumentPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletionUncertain, setDeletionUncertain] = useState(false);
  const busy = action !== "";
  const canManage = family.role === "OWNER" || family.role === "ADMIN";
  const canUpload = family.role !== "VIEWER" && family.profiles.length > 0 && family.categories.length > 0;
  const mutationInFlight = useRef(false);
  const mounted = useRef(true);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (selectedId) detailHeading.current?.focus();
  }, [selectedId]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, profileFilter, categoryFilter, statusFilter, verificationFilter, fromFilter, toFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    setResult(null);
    const query = new URLSearchParams({ familyId: family.id, page: String(page), pageSize: "20" });
    if (searchTerm) query.set("q", searchTerm);
    if (profileFilter) query.set("profileId", profileFilter);
    if (categoryFilter) query.set("categoryId", categoryFilter);
    if (statusFilter) query.set("status", statusFilter);
    if (verificationFilter) query.set("verificationStatus", verificationFilter);
    if (fromFilter) query.set("from", fromFilter);
    if (toFilter) query.set("to", toFilter);
    documentRequest<DocumentPage>(`/api/search/documents?${query}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult(data);
    }).catch(error => {
      if (!controller.signal.aborted) setListError(messageOf(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [family.id, page, revision, searchTerm, profileFilter, categoryFilter, statusFilter, verificationFilter, fromFilter, toFilter]);

  useEffect(() => {
    setDetail(null);
    setDetailError("");
    setConfirmDelete(false);
    if (!selectedId) { setDetailLoading(false); return; }
    const controller = new AbortController();
    setDetailLoading(true);
    documentRequest<DocumentSummary>(`/api/documents/${encodeURIComponent(selectedId)}`, { signal: controller.signal }).then(data => {
      if (data.familyId !== family.id) throw new Error("Document not found in this family.");
      if (!controller.signal.aborted) setDetail(data);
    }).catch(error => {
      if (!controller.signal.aborted) setDetailError(messageOf(error));
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, family.id, revision]);

  function refresh() {
    setPage(1);
    setRevision(value => value + 1);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchTerm(searchInput.trim());
    setPage(1);
  }

  function clearSearch() {
    setSearchInput("");
    setSearchTerm("");
    setProfileFilter("");
    setCategoryFilter("");
    setStatusFilter("");
    setVerificationFilter("");
    setFromFilter("");
    setToFilter("");
    setPage(1);
  }

  async function runAction(name: string, operation: () => Promise<void>) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setAction(name);
    onBusyChange(true);
    setActionError("");
    setNotice("");
    try { await operation(); }
    catch (error) { if (mounted.current) setActionError(messageOf(error)); }
    finally {
      mutationInFlight.current = false;
      onBusyChange(false);
      if (mounted.current) setAction("");
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("familyId", family.id);
    data.set("sensitive", data.has("sensitive") ? "true" : "false");
    data.set("enhanceWithAI", "false");
    void runAction("upload", async () => {
      const file = data.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose a non-empty document file.");
      if (file.size > 25 * 1024 * 1024) throw new Error("Files must be at most 25 MB.");
      const uploaded = await documentRequest<{ id: string; status: string; processingQueued: boolean }>("/api/documents", { method: "POST", body: data });
      if (!mounted.current) return;
      form.reset();
      setNotice(`Document uploaded. Status: ${statusLabel(uploaded.status)}.`);
      setSelectedId(uploaded.id);
      setDeletionUncertain(false);
      refresh();
    });
  }

  function approve() {
    if (!detail) return;
    void runAction("approve", async () => {
      await documentRequest(`/api/documents/${encodeURIComponent(detail.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
      if (!mounted.current) return;
      setNotice("Document approved.");
      refresh();
    });
  }

  function download() {
    if (!detail) return;
    void runAction("download", async () => {
      const access = await documentRequest<{ url: string; expiresAt: string }>(`/api/documents/${encodeURIComponent(detail.id)}/download`, { method: "POST" });
      const url = new URL(access.url, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== "/api/storage/access") throw new Error("The server returned an unexpected download URL.");
      // Redeem through the authenticated application endpoint, not Appwrite.
      // Fetch before saving so 401/404/503 responses are shown instead of downloaded as files.
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error" });
      if (!response.ok) throw await responseError(response);
      const body = await response.blob();
      if (!mounted.current) return;
      const objectUrl = URL.createObjectURL(body);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = (detail.versions.find(version => version.kind === "ORIGINAL")?.fileName ?? "document").replace(/[^a-zA-Z0-9._-]/g, "_");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setNotice("Secure download received; file handed to your browser.");
    });
  }

  function deleteDocument() {
    if (!detail) return;
    void runAction("delete", async () => {
      try {
        const deleted = await documentRequest<{ deleted: boolean }>(`/api/documents/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
        if (!deleted.deleted) throw new Error("The server did not confirm deletion.");
      } catch (error) {
        if (mounted.current) setDeletionUncertain(true);
        throw error;
      }
      if (!mounted.current) return;
      setNotice("Document deleted and private storage cleaned up.");
      setSelectedId(null);
      setDetail(null);
      setConfirmDelete(false);
      setDeletionUncertain(false);
      refresh();
    });
  }

  const hasSearchFilters = Boolean(searchTerm || profileFilter || categoryFilter || statusFilter || verificationFilter || fromFilter || toFilter);

  return <>
    <section className={styles.panel} aria-labelledby="search-heading">
      <div className="block-heading"><div><h2 id="search-heading">Search documents</h2><p className={styles.searchHint}>Search titles, original filenames, document types, profiles, categories and persisted metadata.</p></div>{hasSearchFilters && <button type="button" className="secondary-btn" onClick={clearSearch}>Clear filters</button>}</div>
      <form className={styles.searchForm} onSubmit={submitSearch}>
        <div className={styles.searchInput}><label className={styles.searchField}>Search documents<input aria-label="Search documents" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Search documents…" maxLength={120} /></label><button type="submit" className="primary-btn">Search</button></div>
        <div className={styles.searchGrid}>
          <label className={styles.searchField}>Profile<select aria-label="Filter by profile" value={profileFilter} onChange={event => setProfileFilter(event.target.value)}><option value="">All profiles</option>{family.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label className={styles.searchField}>Category<select aria-label="Filter by category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">All categories</option>{family.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className={styles.searchField}>Status<select aria-label="Filter by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="PROCESSING">Processing</option><option value="UPLOADED">Uploaded</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option><option value="ARCHIVED">Archived</option></select></label>
          <label className={styles.searchField}>Verification<select aria-label="Filter by verification" value={verificationFilter} onChange={event => setVerificationFilter(event.target.value)}><option value="">Any verification</option><option value="VERIFIED">Verified</option><option value="UNVERIFIED">Not verified</option></select></label>
          <label className={styles.searchField}>From date<input aria-label="Filter from date" type="date" value={fromFilter} onChange={event => setFromFilter(event.target.value)} /></label>
          <label className={styles.searchField}>To date<input aria-label="Filter to date" type="date" value={toFilter} onChange={event => setToFilter(event.target.value)} /></label>
        </div>
      </form>
    </section>

    <section className={styles.panel} id="upload" aria-labelledby="upload-heading">
      <h2 id="upload-heading">Upload document</h2>
      <p className="small-muted">PDF, JPEG, PNG, WebP, DOC or DOCX · up to 25 MB. The server validates the file before private storage.</p>
      {!canUpload ? <p role="status">{family.role === "VIEWER" ? "Your viewer role cannot upload documents." : "This family needs an existing profile and category before you can upload. Profile/category creation is not available on this screen."}</p> : <form onSubmit={upload}>
        <fieldset className={styles.form} disabled={busy}>
          <legend className={styles.srOnly}>Document upload details</legend>
          <label>Title<input name="title" required maxLength={120} /></label>
          <label>Document type<input name="documentType" required maxLength={80} placeholder="e.g. Insurance" /></label>
          <label>Profile<select name="profileId" required defaultValue=""><option value="" disabled>Choose profile</option>{family.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label>Category<select name="categoryId" required defaultValue=""><option value="" disabled>Choose category</option>{family.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className={styles.wide}>File<input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" /></label>
          <label className={styles.checkbox}><input name="sensitive" type="checkbox" defaultChecked />Sensitive document</label>
          <div className={styles.wide}><button className="primary-btn" type="submit">{action === "upload" ? "Uploading…" : "Upload document"}</button></div>
        </fieldset>
      </form>}
    </section>

    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {actionError && <p className={styles.error} role="alert">{actionError}</p>}
    {busy && <p role="status" className="small-muted">{statusLabel(action)} in progress. Please keep this page open.</p>}

    <section aria-labelledby="documents-heading" aria-busy={loading}>
      <div className="block-heading"><h2 id="documents-heading">Family documents</h2><button type="button" className="secondary-btn" disabled={busy || loading} onClick={refresh}>Refresh documents</button></div>
      {loading && <p role="status">Loading documents…</p>}
      {listError && <div className={styles.error} role="alert"><p>{listError}</p><button type="button" className="secondary-btn" disabled={busy} onClick={refresh}>Retry list</button></div>}
      {!loading && result && <>
        {result.items.length === 0 ? <div className={styles.panel}><h3>{hasSearchFilters ? "No matching documents" : page === 1 ? "No documents yet" : "No documents on this page"}</h3><p>{hasSearchFilters ? "Try a different search or clear the filters." : page === 1 ? "Uploaded documents in this family will appear here." : "Return to the previous page or refresh the list."}</p></div> : <div className="doc-list">{result.items.map(doc => <article key={doc.id} className={`doc-card ${styles.card}`}>
          <div className="doc-thumb"><FileText size={19} /></div>
          <div className={styles.cardBody}>
            <button type="button" className={styles.documentTitle} disabled={busy} aria-label={`View document: ${doc.title}`} onClick={() => { setSelectedId(doc.id); setActionError(""); setNotice(""); setDeletionUncertain(false); }}>{doc.title}</button>
            <p className="doc-sub">{doc.profile.name} · {doc.category.name} · {doc.documentType}</p>
            <p className="doc-sub">Uploaded {dateLabel(doc.createdAt)} · Updated {dateLabel(doc.updatedAt)}</p>
            {doc.versions[0] && <p className="doc-sub">{doc.versions[0].mimeType} · {fileSize(doc.versions[0].byteSize)}</p>}
            <p className="doc-sub">{doc.verifiedAt ? `Verified ${dateLabel(doc.verifiedAt)}` : "Not verified"}</p>
          </div>
          <span className={styles.status}>{statusLabel(doc.status)}</span>
        </article>)}</div>}
        <div className={styles.actions} aria-label="Document pagination">
          <button type="button" className="secondary-btn" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span>{result.total} documents · Page {page} of {Math.max(1, result.pages)}</span>
          <button type="button" className="secondary-btn" disabled={!(result.hasNextPage ?? page < result.pages) || busy} onClick={() => setPage(value => value + 1)}>Next</button>
        </div>
      </>}
    </section>

    {selectedId && <section className={styles.panel} aria-labelledby="detail-heading" aria-busy={detailLoading}>
      <div className="block-heading"><h2 id="detail-heading" ref={detailHeading} tabIndex={-1}>Document details</h2><button className="secondary-btn" type="button" disabled={busy} onClick={() => setSelectedId(null)}>Close details</button></div>
      {detailLoading && <p role="status">Loading document details…</p>}
      {detailError && <div role="alert" className={styles.error}><p>{detailError}</p><button type="button" className="secondary-btn" disabled={busy} onClick={() => setRevision(value => value + 1)}>Retry details</button></div>}
      {detail && <>
        <h3>{detail.title}</h3>
        <dl className={styles.metadata}>
          <dt>Profile</dt><dd>{detail.profile.name}</dd>
          <dt>Category / type</dt><dd>{detail.category.name} / {detail.documentType}</dd>
          <dt>Status</dt><dd>{statusLabel(detail.status)}</dd>
          <dt>Verification</dt><dd>{detail.verifiedAt ? dateLabel(detail.verifiedAt) : "Not verified"}</dd>
          <dt>Review note</dt><dd>{detail.verificationNote || "No note"}</dd>
          <dt>Uploaded</dt><dd>{dateLabel(detail.createdAt)}</dd>
          <dt>Updated</dt><dd>{dateLabel(detail.updatedAt)}</dd>
          <dt>Sensitive</dt><dd>{detail.sensitive ? "Yes" : "No"}</dd>
        </dl>
        <h3>Stored versions</h3>
        <ul>{detail.versions.map((version, index) => <li key={version.id ?? index}>{version.fileName} · {version.kind} · {version.mimeType} · {fileSize(version.byteSize)}</li>)}</ul>
        {!downloadStatuses.has(detail.status) && <p className="small-muted">Download is unavailable until the document is approved. Owners and admins can approve it.</p>}
        {deletionUncertain && <p role="alert">Deletion was not confirmed. Do not assume the file is removed. Retry deletion or contact an administrator for reconciliation.</p>}
        <div className={styles.actions}>
          <button type="button" className="primary-btn" disabled={busy || deletionUncertain || !downloadStatuses.has(detail.status)} onClick={download}>Download original</button>
          {canManage && ["PENDING_APPROVAL", "REJECTED", "UPLOADED"].includes(detail.status) && <button type="button" className="secondary-btn" disabled={busy || deletionUncertain} onClick={approve}>Approve document</button>}
          {canManage && <button type="button" className="secondary-btn" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete document</button>}
        </div>
        {!canManage && <p className="small-muted">Only a family owner or admin can approve or delete documents.</p>}
        {confirmDelete && <div className={styles.confirm}>
          <p>Delete “{detail.title}”? All stored file versions will be removed. This cannot be undone.</p>
          <div className={styles.actions}><button type="button" className="primary-btn" disabled={busy} onClick={deleteDocument}>Confirm deletion</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button></div>
        </div>}
      </>}
    </section>}
  </>;
}
