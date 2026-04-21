import { createClient } from "@vercel/edge-config";
import { Vercel } from "@vercel/sdk";

import { env } from "@/env";

const BATCH_KEY_PREFIX = "hack-night:batch:";

let edgeClient: ReturnType<typeof createClient> | null = null;

function getEdgeClient(): ReturnType<typeof createClient> {
  edgeClient ??= createClient(env.EDGE_CONFIG);
  return edgeClient;
}

/** Returns `YYYY-MM-DD` for the most recent Friday at or before `date` (in UTC). */
export function hackNightDateKey(date: Date): string {
  const daysSinceFriday = (date.getUTCDay() + 2) % 7;
  const friday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceFriday),
  );
  const y = friday.getUTCFullYear();
  const m = String(friday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(friday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Extracts the creation timestamp embedded in a Discord snowflake. */
export function snowflakeToDate(snowflake: string): Date {
  return new Date(Number((BigInt(snowflake) >> 22n) + 1420070400000n));
}

/** Read-only lookup. Returns `null` if no batch has been seeded for the given key. */
export async function getBatchId(dateKey: string): Promise<string | null> {
  const raw = await getEdgeClient().get(`${BATCH_KEY_PREFIX}${dateKey}`);
  return typeof raw === "string" ? raw : null;
}

/**
 * Read-or-create the batch UUID for the given hack-night date. Races are
 * tolerated: a second caller that doesn't see the first's write will mint its
 * own id and overwrite, producing at worst one duplicate batch. Acceptable for
 * the low upload rate in a single hack-night thread.
 */
export async function getOrCreateBatchId(dateKey: string): Promise<string> {
  const existing = await getBatchId(dateKey);
  if (existing) return existing;

  const next = crypto.randomUUID();
  const vercel = new Vercel({ bearerToken: env.VERCEL_API_TOKEN });
  await vercel.edgeConfig.patchEdgeConfigItems({
    edgeConfigId: env.VERCEL_EDGE_CONFIG_ID,
    requestBody: {
      items: [
        {
          operation: "upsert",
          key: `${BATCH_KEY_PREFIX}${dateKey}`,
          value: next,
        },
      ],
    },
  });
  return next;
}
