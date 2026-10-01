import path from "node:path";
import { config as loadEnv } from "dotenv";
import { AppwriteException, Client, Compression, Storage } from "node-appwrite";

loadEnv({ path: path.resolve(__dirname, "../.env") });

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function main() {
  const client = new Client()
    .setEndpoint(required("APPWRITE_ENDPOINT"))
    .setProject(required("APPWRITE_PROJECT_ID"))
    .setKey(required("APPWRITE_API_KEY"));

  const bucketId = required("APPWRITE_BUCKET_ID");
  const storage = new Storage(client);

  try {
    const bucket = await storage.getBucket({ bucketId });

    if (!bucket.fileSecurity || bucket.$permissions.length > 0) {
      throw new Error(
        `Bucket ${bucketId} is not private; refusing to change or use it`,
      );
    }

    console.log(
      `Appwrite bucket ${bucketId} already exists and is private; no changes made.`,
    );
  } catch (error) {
    if (!(error instanceof AppwriteException) || error.code !== 404) {
      throw error;
    }

    await storage.createBucket({
      bucketId,
      name: "Docsup private documents",
      permissions: [],
      fileSecurity: true,
      enabled: true,
      maximumFileSize: 25 * 1024 * 1024,
      allowedFileExtensions: [
        "pdf",
        "jpg",
        "jpeg",
        "png",
        "webp",
        "doc",
        "docx",
      ],
      compression: Compression.None,
      encryption: true,
      antivirus: true,
      transformations: false,
    });

    console.log(`Created private Appwrite bucket ${bucketId}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});