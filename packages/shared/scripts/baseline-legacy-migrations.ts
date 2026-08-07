/// <reference types="bun" />

import { createClient } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";

const LEGACY_BASELINE_AT = 1_781_249_988_556;

const url = process.env["TURSO_DATABASE_URL"];
if (url === undefined || url === "") throw new Error("TURSO_DATABASE_URL is required");

const migrations = readMigrationFiles({
  migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
});
const baseline = migrations.find(({ folderMillis }) => folderMillis === LEGACY_BASELINE_AT);
if (baseline === undefined) throw new Error("the legacy 0002 migration is missing");

const expectedColumns = {
  action_audit: [
    "id",
    "at",
    "user_id",
    "role",
    "source",
    "delegate",
    "tool",
    "risk",
    "input_hash",
    "input_preview",
    "reason",
    "decision",
    "decided_by",
    "trace_id",
  ],
  scheduled_tasks: [
    "id",
    "user_id",
    "channel_id",
    "description",
    "schedule_type",
    "run_at",
    "cron",
    "timezone",
    "action",
    "member_roles",
    "status",
    "next_run_at",
    "queue_message_id",
    "last_fired_at",
    "fire_count",
    "max_drift_ms",
    "created_at",
    "updated_at",
  ],
  shopping_cart_items: ["id", "cart_id", "asin", "title", "price", "quantity", "added_at"],
  shopping_carts: ["id", "created_at", "updated_at"],
} as const;

const expectedIndexes = [
  "action_audit_tool_at_idx",
  "action_audit_user_at_idx",
  "scheduled_tasks_status_next_run_idx",
  "scheduled_tasks_user_status_idx",
  "shopping_cart_items_cart_asin_uq",
] as const;

function requiredName(row: Record<string, unknown>): string {
  const name = row["name"];
  if (typeof name !== "string") throw new Error("SQLite metadata returned a non-string name");
  return name;
}

const authToken = process.env["TURSO_AUTH_TOKEN"];
const client = createClient(authToken === undefined ? { url } : { url, authToken });
try {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  const history = await client.execute(
    "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC",
  );
  const applied = history.rows.map(({ created_at }) => Number(created_at));
  if (applied.some((createdAt) => createdAt > LEGACY_BASELINE_AT)) {
    console.info("legacy schema has already advanced beyond the baseline");
  } else {
    const alreadyBaselined = applied.length === 1 && applied[0] === LEGACY_BASELINE_AT;
    if (applied.length !== 0 && !alreadyBaselined) {
      throw new Error("refusing to overwrite a partial migration history");
    }

    for (const [table, expected] of Object.entries(expectedColumns)) {
      const result = await client.execute(`PRAGMA table_info(${table})`);
      const actual = result.rows.map(requiredName);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${table} does not match the verified legacy schema`);
      }
    }

    const indexes = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
    );
    const actualIndexes = indexes.rows.map(requiredName);
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
      throw new Error("legacy indexes do not match the verified baseline");
    }

    await client.batch(
      [
        {
          sql: `
            CREATE TABLE IF NOT EXISTS __wack_legacy_schedule_roles_v1 (
              id text PRIMARY KEY NOT NULL,
              member_roles text
            )
          `,
          args: [],
        },
        {
          sql: `
            INSERT OR REPLACE INTO __wack_legacy_schedule_roles_v1 (id, member_roles)
            SELECT id, member_roles FROM scheduled_tasks
          `,
          args: [],
        },
        {
          sql: `
            INSERT INTO __drizzle_migrations (hash, created_at)
            SELECT ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM __drizzle_migrations)
          `,
          args: [baseline.hash, baseline.folderMillis],
        },
      ],
      "write",
    );
    console.info("verified the legacy baseline through 0002 and preserved schedule-role snapshots");
  }
} finally {
  client.close();
}
