#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import type { Row } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

import { tursoEnv } from "../src/env/scripts.ts";

const { url, authToken } = tursoEnv();
const client = createClient(authToken === undefined ? { url } : { url, authToken });

const migrations = readMigrationFiles({
  migrationsFolder: new URL("../migrations", import.meta.url).pathname,
}).sort((left, right) => left.folderMillis - right.folderMillis);
const latest = migrations.at(-1);
if (latest === undefined) throw new Error("repository has no database migrations");

/** `PRAGMA table_info` names every column. A non-string means a broken driver. */
const columnNameSchema = z.string();

function rowName(row: Row): string {
  const name = columnNameSchema.safeParse(row["name"]);
  if (!name.success) throw new Error("SQLite returned a malformed column name");
  return name.data;
}

try {
  const quickCheck = await client.execute("PRAGMA quick_check");
  if (
    quickCheck.rows.length !== 1 ||
    Object.values(quickCheck.rows[0] ?? {}).some((value) => value !== "ok")
  ) {
    throw new Error(`PRAGMA quick_check failed: ${JSON.stringify(quickCheck.rows)}`);
  }

  const ledger = await client.execute(
    "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC",
  );
  const latestRows = ledger.rows.filter(
    ({ created_at }) => Number(created_at) === latest.folderMillis,
  );
  if (
    latestRows.length !== 1 ||
    latestRows[0]?.["hash"] !== latest.hash ||
    ledger.rows.some(({ created_at }) => Number(created_at) > latest.folderMillis)
  ) {
    throw new Error("database migration ledger does not end at the reviewed repository migration");
  }

  const requiredColumns = {
    action_audit: ["id", "at", "user_id", "tool", "decision"],
    scheduled_tasks: [
      "id",
      "owner_id",
      "channel_id",
      "action_type",
      "prompt",
      "status",
      "next_run_at",
      "available_at",
      "lease_token",
      "lease_expires_at",
      "attempt_count",
      "last_error",
    ],
    shopping_carts: ["id", "created_at", "updated_at"],
  } as const;
  for (const [table, required] of Object.entries(requiredColumns)) {
    const result = await client.execute(`PRAGMA table_info(${table})`);
    const actual = new Set(result.rows.map(rowName));
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length > 0) throw new Error(`${table} is missing columns: ${missing.join(", ")}`);
  }

  console.info(
    JSON.stringify({
      ok: true,
      migrationCreatedAt: latest.folderMillis,
      migrationHash: latest.hash,
      ledgerEntries: ledger.rows.length,
      quickCheck: "ok",
    }),
  );
} finally {
  client.close();
}
