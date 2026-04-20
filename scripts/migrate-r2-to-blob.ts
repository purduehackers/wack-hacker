/**
 * One-shot R2 → Vercel Blob + Turso data migration.
 *
 * - Copies every non-index image/video blob from each R2 bucket to the
 *   corresponding Vercel Blob store, preserving the object key as the pathname.
 * - Parses every `images/<slug>/index.json` in the events bucket and seeds the
 *   `hack_night_images` Turso table. The JSON indices themselves are NOT
 *   copied to Blob — the table is the new source of truth.
 *
 * Idempotent: blob writes use `allowOverwrite: true`, SQL inserts use
 * `onConflictDoNothing`. Safe to re-run if interrupted.
 *
 * Needs R2_*, *_BLOB_READ_WRITE_TOKEN, and TURSO_{DATABASE_URL,AUTH_TOKEN} in
 * the environment. Pull them locally with:
 *   bunx vercel env pull .env.local --yes
 * then run:
 *   bun run scripts/migrate-r2-to-blob.ts
 *
 * Disposable: delete this file (and `@aws-sdk/client-s3` from devDependencies)
 * once the migration has completed successfully.
 */

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@libsql/client";
import { put } from "@vercel/blob";
import { drizzle } from "drizzle-orm/libsql";

import { hackNightImages } from "../src/lib/db/schemas/hack-night-images.ts";

type BucketPass = {
  label: "events" | "ship";
  bucket: string;
  blobToken: string;
};

type Db = ReturnType<typeof drizzle>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function seedIndexFromJson(db: Db, eventSlug: string, body: Uint8Array): Promise<number> {
  const text = new TextDecoder().decode(body);
  const parsed = JSON.parse(text) as {
    images?: Array<{
      filename: string;
      uploadedAt: string;
      discordMessageId: string;
      discordUserId: string;
    }>;
  };
  const images = parsed.images ?? [];
  if (images.length === 0) return 0;

  await db
    .insert(hackNightImages)
    .values(
      images.map((img) => ({
        eventSlug,
        filename: img.filename,
        uploadedAt: img.uploadedAt,
        discordMessageId: img.discordMessageId,
        discordUserId: img.discordUserId,
      })),
    )
    .onConflictDoNothing();
  return images.length;
}

type PassStats = { copied: number; indexed: number; failed: number; bytes: number };

const INDEX_KEY_PATTERN = /^images\/(.+)\/index\.json$/;

async function handleObject(
  s3: S3Client,
  db: Db,
  pass: BucketPass,
  key: string,
  stats: PassStats,
): Promise<void> {
  const got = await s3.send(new GetObjectCommand({ Bucket: pass.bucket, Key: key }));
  if (!got.Body) throw new Error("empty body");
  const arr = await got.Body.transformToByteArray();

  const eventsIndexMatch = pass.label === "events" ? INDEX_KEY_PATTERN.exec(key) : null;
  if (eventsIndexMatch) {
    const slug = eventsIndexMatch[1]!;
    stats.indexed += await seedIndexFromJson(db, slug, arr);
    return;
  }

  await put(key, Buffer.from(arr), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: got.ContentType ?? "application/octet-stream",
    token: pass.blobToken,
  });
  stats.copied += 1;
  stats.bytes += arr.byteLength;
}

async function migrateBucket(s3: S3Client, db: Db, pass: BucketPass): Promise<void> {
  console.log(`\n=== ${pass.label} (${pass.bucket}) ===`);

  const stats: PassStats = { copied: 0, indexed: 0, failed: 0, bytes: 0 };
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: pass.bucket,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of res.Contents ?? []) {
      const key = obj.Key;
      if (!key) continue;
      try {
        await handleObject(s3, db, pass, key, stats);
        if (stats.copied > 0 && stats.copied % 25 === 0) {
          console.log(`  ...${stats.copied} copied`);
        }
      } catch (err) {
        stats.failed += 1;
        console.warn(`  FAIL ${key}: ${String(err)}`);
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(
    `Done: ${stats.copied} blobs copied, ${stats.indexed} rows indexed, ${stats.failed} failed, ${(stats.bytes / (1024 * 1024)).toFixed(2)} MiB`,
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

  const db = drizzle(
    createClient({
      url: requireEnv("TURSO_DATABASE_URL"),
      authToken: requireEnv("TURSO_AUTH_TOKEN"),
    }),
  );

  const passes: BucketPass[] = [
    {
      label: "events",
      bucket: requireEnv("EVENTS_R2_BUCKET_NAME"),
      blobToken: requireEnv("EVENTS_BLOB_READ_WRITE_TOKEN"),
    },
    {
      label: "ship",
      bucket: requireEnv("SHIP_R2_BUCKET_NAME"),
      blobToken: requireEnv("SHIPS_BLOB_READ_WRITE_TOKEN"),
    },
  ];

  for (const pass of passes) {
    await migrateBucket(s3, db, pass);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
