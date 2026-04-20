/**
 * One-shot R2 → Vercel Blob data migration.
 *
 * Copies every object in each R2 bucket to the corresponding Vercel Blob store,
 * preserving the object key as the Blob pathname. Idempotent (`allowOverwrite: true`),
 * so it's safe to re-run if interrupted.
 *
 * Needs R2_* and *_BLOB_READ_WRITE_TOKEN in the environment. Pull them locally with:
 *   bunx vercel env pull .env.local --yes
 * then run:
 *   bun run scripts/migrate-r2-to-blob.ts
 *
 * Disposable: delete this file (and `@aws-sdk/client-s3` from devDependencies) once
 * the migration has completed successfully.
 */

import { GetObjectCommand, ListObjectsV2Command, S3Client, type _Object } from "@aws-sdk/client-s3";
import { put } from "@vercel/blob";

type BucketPass = {
  label: string;
  bucket: string;
  blobToken: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function listAll(s3: S3Client, bucket: string): Promise<_Object[]> {
  const all: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    if (res.Contents) all.push(...res.Contents);
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return all;
}

async function migrateBucket(s3: S3Client, pass: BucketPass): Promise<void> {
  console.log(`\n=== ${pass.label} (${pass.bucket}) ===`);
  const objects = await listAll(s3, pass.bucket);
  console.log(`Found ${objects.length} objects`);

  let copied = 0;
  let failed = 0;
  let bytes = 0;

  for (const obj of objects) {
    const key = obj.Key;
    if (!key) continue;

    try {
      const got = await s3.send(new GetObjectCommand({ Bucket: pass.bucket, Key: key }));
      if (!got.Body) throw new Error("empty body");
      const arr = await got.Body.transformToByteArray();
      const contentType = got.ContentType ?? "application/octet-stream";

      await put(key, Buffer.from(arr), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
        token: pass.blobToken,
      });
      copied += 1;
      bytes += arr.byteLength;
      if (copied % 25 === 0) console.log(`  ...${copied} copied`);
    } catch (err) {
      failed += 1;
      console.warn(`  FAIL ${key}: ${String(err)}`);
    }
  }

  console.log(
    `Done: ${copied} copied, ${failed} failed, ${(bytes / (1024 * 1024)).toFixed(2)} MiB`,
  );
}

async function main(): Promise<void> {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const passes: BucketPass[] = [
    {
      label: "events",
      bucket: requireEnv("EVENTS_R2_BUCKET_NAME"),
      blobToken: requireEnv("EVENTS_BLOB_READ_WRITE_TOKEN"),
    },
    {
      label: "ship",
      bucket: requireEnv("SHIP_R2_BUCKET_NAME"),
      blobToken: requireEnv("SHIP_BLOB_READ_WRITE_TOKEN"),
    },
  ];

  for (const pass of passes) {
    await migrateBucket(s3, pass);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
