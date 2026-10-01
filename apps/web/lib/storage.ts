export interface PrivateStorage { put(key: string, body: Uint8Array, contentType: string): Promise<void>; signedUrl(key: string, expiresInSeconds: number): Promise<string>; remove(key: string): Promise<void>; }

/** Production adapter seam. Configure an S3-compatible implementation before accepting uploads. */
export class S3PrivateStorage implements PrivateStorage {
  async put(): Promise<void> { throw new Error("STORAGE_NOT_CONFIGURED"); }
  async signedUrl(): Promise<string> { throw new Error("STORAGE_NOT_CONFIGURED"); }
  async remove(): Promise<void> { throw new Error("STORAGE_NOT_CONFIGURED"); }
}
