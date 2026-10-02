// JSON contracts consumed from the existing document routes. No storage credentials
// or Appwrite URLs belong in this browser module.
export type DocumentFamily = {
  id: string;
  name: string;
  role: string;
  profiles: { id: string; name: string }[];
  categories: { id: string; name: string }[];
};

export type DocumentVersionSummary = {
  id?: string;
  kind: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt?: string;
};

export type DocumentSummary = {
  id: string;
  familyId: string;
  title: string;
  documentType: string;
  status: string;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  verificationNote?: string | null;
  profile: { name: string };
  category: { name: string };
  versions: DocumentVersionSummary[];
};

export type DocumentPage = {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  hasNextPage?: boolean;
};

export async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  const message = typeof body?.error?.message === "string" ? body.error.message : `Request failed (${response.status}). Please try again.`;
  return new Error(response.status === 401 ? "Your session is unavailable or expired. Please sign in again." : message);
}

export async function documentRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  const body = await response.json();
  if (!body || !("data" in body)) throw new Error("The server returned an unexpected response.");
  return body.data as T;
}

export function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
