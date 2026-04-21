/**
 * One-shot: backfill all rows from the Turso `hack_night_images` table
 * (plus their Vercel Blob images) into Payload as `media` with
 * `source='hack-night'`, `discordMessageId`, `discordUserId`, and a shared
 * per-event `batchId` stored in Edge Config so the live bot sees the same id.
 *
 * Idempotent: per-file dedup via `?where[filename][equals]=…`, per-slug
 * batchId reused if any of the group's media already has one assigned.
 *
 * Needs: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, EVENTS_BLOB_READ_WRITE_TOKEN,
 *        PAYLOAD_CMS_URL, PAYLOAD_SERVICE_ACCOUNT_API_KEY,
 *        VERCEL_API_TOKEN, VERCEL_EDGE_CONFIG_ID, EDGE_CONFIG.
 * Pull with `bunx vercel env pull .env.local --yes` then:
 *   bun run scripts/migrate-hack-night-to-payload.ts
 *   bun run scripts/migrate-hack-night-to-payload.ts --slug=hack-night-2026-04-10
 */

import type { InValue } from "@libsql/client";

import { createClient } from "@libsql/client";
import { head } from "@vercel/blob";
import { createClient as createEdgeConfig } from "@vercel/edge-config";
import { Vercel } from "@vercel/sdk";

type Row = {
  event_slug: string;
  filename: string;
  discord_message_id: string;
  discord_user_id: string;
  uploaded_at: string;
};

type Env = {
  cmsUrl: string;
  apiKey: string;
  blobToken: string;
  edgeConfigToken: string;
};

type Stats = { copied: number; skipped: number; failed: number; bytes: number };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function slugToDateKey(slug: string): string {
  // slug is `hack-night-YYYY-MM-DD`
  return slug.replace(/^hack-night-/, "");
}

async function findMediaByFilename(env: Env, filename: string): Promise<number> {
  const url = new URL(`${env.cmsUrl}/api/media`);
  url.searchParams.set("where[filename][equals]", filename);
  url.searchParams.set("depth", "0");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, {
    headers: { Authorization: `service-accounts API-Key ${env.apiKey}` },
  });
  if (!res.ok) throw new Error(`media lookup failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { totalDocs: number };
  return json.totalDocs;
}

async function findBatchIdForGroup(env: Env, group: Row[]): Promise<string | null> {
  for (const entry of group) {
    const url = new URL(`${env.cmsUrl}/api/media`);
    url.searchParams.set("where[discordMessageId][equals]", entry.discord_message_id);
    url.searchParams.set("where[source][equals]", "hack-night");
    url.searchParams.set("depth", "0");
    url.searchParams.set("limit", "1");
    const res = await fetch(url, {
      headers: { Authorization: `service-accounts API-Key ${env.apiKey}` },
    });
    if (!res.ok) continue;
    const json = (await res.json()) as { docs: Array<{ batchId?: string | null }> };
    const existing = json.docs[0]?.batchId;
    if (existing) return existing;
  }
  return null;
}

async function uploadOne(
  env: Env,
  entry: Row,
  batchId: string,
): Promise<{ skipped: boolean; bytes: number }> {
  const filename = `${entry.discord_message_id}-${entry.filename}`;
  const existing = await findMediaByFilename(env, filename);
  if (existing > 0) return { skipped: true, bytes: 0 };

  const blobMeta = await head(`images/${entry.event_slug}/${entry.filename}`, {
    token: env.blobToken,
  });
  const res = await fetch(blobMeta.url);
  if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: blobMeta.contentType }), filename);
  form.append(
    "_payload",
    JSON.stringify({
      alt: `Migrated hack-night photo (${entry.event_slug})`,
      batchId,
      discordMessageId: entry.discord_message_id,
      discordUserId: entry.discord_user_id,
      source: "hack-night",
    }),
  );

  const uploadRes = await fetch(`${env.cmsUrl}/api/media`, {
    method: "POST",
    headers: { Authorization: `service-accounts API-Key ${env.apiKey}` },
    body: form,
  });
  if (!uploadRes.ok) {
    throw new Error(`media upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  return { skipped: false, bytes: bytes.byteLength };
}

async function writeEdgeConfigBatch(dateKey: string, batchId: string): Promise<void> {
  const vercel = new Vercel({ bearerToken: requireEnv("VERCEL_API_TOKEN") });
  await vercel.edgeConfig.patchEdgeConfigItems({
    edgeConfigId: requireEnv("VERCEL_EDGE_CONFIG_ID"),
    requestBody: {
      items: [{ operation: "upsert", key: `hack-night:batch:${dateKey}`, value: batchId }],
    },
  });
}

async function resolveBatchId(env: Env, dateKey: string, group: Row[]): Promise<string> {
  const edge = createEdgeConfig(env.edgeConfigToken);
  const fromEdge = await edge.get(`hack-night:batch:${dateKey}`);
  if (typeof fromEdge === "string" && fromEdge) return fromEdge;

  const fromPayload = await findBatchIdForGroup(env, group);
  if (fromPayload) return fromPayload;

  return crypto.randomUUID();
}

async function migrateSlug(opts: { env: Env; slug: string; group: Row[] }): Promise<Stats> {
  const { env, slug, group } = opts;
  console.log(`\n=== ${slug} (${group.length} rows) ===`);

  const dateKey = slugToDateKey(slug);
  const batchId = await resolveBatchId(env, dateKey, group);
  console.log(`  batchId=${batchId}`);
  await writeEdgeConfigBatch(dateKey, batchId);

  const stats: Stats = { copied: 0, skipped: 0, failed: 0, bytes: 0 };
  for (const entry of group) {
    try {
      const { skipped, bytes } = await uploadOne(env, entry, batchId);
      if (skipped) stats.skipped += 1;
      else {
        stats.copied += 1;
        stats.bytes += bytes;
      }
      if ((stats.copied + stats.skipped) % 25 === 0) {
        console.log(`  ...${stats.copied} copied, ${stats.skipped} skipped`);
      }
    } catch (err) {
      stats.failed += 1;
      console.warn(`  FAIL ${entry.event_slug}/${entry.filename}: ${String(err)}`);
    }
  }

  console.log(
    `Done ${slug}: ${stats.copied} copied, ${stats.skipped} skipped, ${stats.failed} failed, ${(stats.bytes / (1024 * 1024)).toFixed(2)} MiB`,
  );
  return stats;
}

async function main(): Promise<void> {
  const onlyArg = process.argv.find((a) => a.startsWith("--slug="));
  const only = onlyArg?.slice("--slug=".length);

  const env: Env = {
    cmsUrl: requireEnv("PAYLOAD_CMS_URL"),
    apiKey: requireEnv("PAYLOAD_SERVICE_ACCOUNT_API_KEY"),
    blobToken: requireEnv("EVENTS_BLOB_READ_WRITE_TOKEN"),
    edgeConfigToken: requireEnv("EDGE_CONFIG"),
  };

  const db = createClient({
    url: requireEnv("TURSO_DATABASE_URL"),
    authToken: requireEnv("TURSO_AUTH_TOKEN"),
  });

  let sql = `SELECT event_slug, filename, discord_message_id, discord_user_id, uploaded_at
             FROM hack_night_images`;
  const args: InValue[] = [];
  if (only) {
    sql += " WHERE event_slug = ?";
    args.push(only);
  }
  sql += " ORDER BY event_slug, uploaded_at";

  const result = await db.execute({ sql, args });
  const fetched = result.rows as unknown as Row[];
  console.log(`Fetched ${fetched.length} rows from Turso${only ? ` for ${only}` : ""}`);

  const groups = new Map<string, Row[]>();
  for (const entry of fetched) {
    const list = groups.get(entry.event_slug) ?? [];
    list.push(entry);
    groups.set(entry.event_slug, list);
  }

  const totals: Stats = { copied: 0, skipped: 0, failed: 0, bytes: 0 };
  for (const [slug, group] of groups) {
    const s = await migrateSlug({ env, slug, group });
    totals.copied += s.copied;
    totals.skipped += s.skipped;
    totals.failed += s.failed;
    totals.bytes += s.bytes;
  }

  console.log(
    `\nAll slugs done: ${totals.copied} copied, ${totals.skipped} skipped, ${totals.failed} failed, ${(totals.bytes / (1024 * 1024)).toFixed(2)} MiB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
