import { AppwriteException, Client, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { randomUUID } from "node:crypto";
import { createStorageAccess, type DownloadContext } from "./storage-access";

export type StorageUpload = {
  fileName: string;
  mimeType: string;
  body: Uint8Array;
  fileId?: string;
};

export type StoredObject = {
  provider: "appwrite" | "local";
  fileId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type SecureAccess = {
  token: string;
  expiresAt: Date;
};

export interface StorageProvider {
  upload(input: StorageUpload & { objectKey: string }): Promise<StoredObject>;
  download(fileId: string): Promise<ArrayBuffer>;
  getMetadata(fileId: string): Promise<{ fileName: string; mimeType: string; byteSize: number }>;
  delete(fileId: string): Promise<void>;
  exists(fileId: string): Promise<boolean>;
  createSecureAccess(context: DownloadContext, expiresInSeconds: number): Promise<SecureAccess>;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`STORAGE_CONFIGURATION_MISSING:${name}`);
  return value;
}

export class AppwriteStorage implements StorageProvider {
  private readonly storage: Storage;
  private readonly bucketId: string;

  constructor() {
    const client = new Client()
      .setEndpoint(required("APPWRITE_ENDPOINT"))
      .setProject(required("APPWRITE_PROJECT_ID"))
      .setKey(required("APPWRITE_API_KEY"));
    this.bucketId = required("APPWRITE_BUCKET_ID");
    this.storage = new Storage(client);
  }

  async upload(input: StorageUpload & { objectKey: string }): Promise<StoredObject> {
    const fileId = input.fileId ?? randomUUID();
    const result = await this.storage.createFile({
      bucketId: this.bucketId,
      fileId,
      file: InputFile.fromBuffer(input.body, input.fileName),
      permissions: [],
    });
    return {
      provider: "appwrite",
      fileId: result.$id,
      objectKey: input.objectKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.body.byteLength,
    };
  }

  async download(fileId: string) {
    return this.storage.getFileDownload({ bucketId: this.bucketId, fileId });
  }

  async getMetadata(fileId: string) {
    const file = await this.storage.getFile({ bucketId: this.bucketId, fileId });
    return { fileName: file.name, mimeType: file.mimeType, byteSize: file.sizeOriginal };
  }

  async delete(fileId: string) {
    try {
      await this.storage.deleteFile({ bucketId: this.bucketId, fileId });
    } catch (error) {
      // Treat an already-removed object as success so retries are safe.
      if (error instanceof AppwriteException && error.code === 404) return;
      throw error;
    }
  }

  async exists(fileId: string) {
    try {
      await this.storage.getFile({ bucketId: this.bucketId, fileId });
      return true;
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 404) return false;
      throw error;
    }
  }

  async createSecureAccess(context: DownloadContext, expiresInSeconds: number) {
    return createStorageAccess(context, expiresInSeconds);
  }
}

let provider: StorageProvider | undefined;
export function getStorageProvider(): StorageProvider {
  if (!provider) provider = new AppwriteStorage();
  return provider;
}
