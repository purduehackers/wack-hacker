#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import type { Row } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

import { tursoEnv } from "../src/env/scripts.ts";
import {
  InvariantViolated,
  RecoveryRequired,
  Transient,
  messageOf,
  serializeError,
} from "../src/errors.ts";
import { Result, fromNullable } from "../src/result/index.ts";

const { url, authToken } = tursoEnv();
const client = createClient(authToken === undefined ? { url } : { url, authToken });

/** `PRAGMA table_info` names every column. A non-string means a broken driver. */
const columnNameSchema = z.string();

/** Reads a column name off a `PRAGMA table_info` row. Absent when the driver misbehaves. */
function rowName(row: Row): string | undefined {
  return columnNameSchema.safeParse(row["name"]).data;
}

/** Runs one statement. A driver or network failure maps onto `Transient`. */
function execute(
  sql: string,
): Promise<Result<Awaited<ReturnType<typeof client.execute>>, Transient>> {
  return Result.tryPromise({
    try: () => client.execute(sql),
    catch: (cause) => new Transient({ operation: sql, detail: messageOf(cause) }),
  });
}

/** Columns the agents and bot read today. A migration that drops one fails here. */
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

const verified = await Result.gen(async function* () {
  const migrationsFolder = yield* fromNullable(
    URL.parse("../migrations", import.meta.url),
    () =>
      new InvariantViolated({
        invariant: "the migrations folder resolves from this script",
        detail: "URL.parse returned nothing for ../migrations",
      }),
  );
  const migrations = yield* Result.try({
    try: () =>
      readMigrationFiles({ migrationsFolder: migrationsFolder.pathname }).sort(
        (left, right) => left.folderMillis - right.folderMillis,
      ),
    catch: (cause) =>
      new InvariantViolated({
        invariant: "repository migrations are readable",
        detail: messageOf(cause),
      }),
  });
  const latest = yield* fromNullable(
    migrations.at(-1),
    () =>
      new InvariantViolated({
        invariant: "the repository has database migrations",
        detail: "readMigrationFiles returned an empty journal",
      }),
  );

  const quickCheck = yield* Result.await(execute("PRAGMA quick_check"));
  if (
    quickCheck.rows.length !== 1 ||
    Object.values(quickCheck.rows[0] ?? {}).some((value) => value !== "ok")
  ) {
    yield* new RecoveryRequired({
      operation: "PRAGMA quick_check",
      detail: JSON.stringify(quickCheck.rows),
      remediation: "restore the database from a known-good backup",
    });
  }

  const ledger = yield* Result.await(
    execute("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC"),
  );
  const latestRows = ledger.rows.filter(
    ({ created_at }) => Number(created_at) === latest.folderMillis,
  );
  if (
    latestRows.length !== 1 ||
    latestRows[0]?.["hash"] !== latest.hash ||
    ledger.rows.some(({ created_at }) => Number(created_at) > latest.folderMillis)
  ) {
    yield* new RecoveryRequired({
      operation: "verify the migration ledger",
      detail: "database migration ledger does not end at the reviewed repository migration",
      remediation: "apply the repository migrations to the database",
    });
  }

  for (const [table, required] of Object.entries(requiredColumns)) {
    const info = yield* Result.await(execute(`PRAGMA table_info(${table})`));
    const actual = new Set(info.rows.map(rowName));
    if (actual.has(undefined)) {
      yield* new InvariantViolated({
        invariant: "PRAGMA table_info names every column",
        detail: `${table} returned a non-string column name`,
      });
    }
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      yield* new InvariantViolated({
        invariant: "migrated tables keep their required columns",
        detail: `${table} is missing columns: ${missing.join(", ")}`,
      });
    }
  }

  return Result.ok({
    ok: true,
    migrationCreatedAt: latest.folderMillis,
    migrationHash: latest.hash,
    ledgerEntries: ledger.rows.length,
    quickCheck: "ok",
  });
}).finally(() => {
  client.close();
});

verified.match({
  ok: (summary) => {
    console.info(JSON.stringify(summary));
  },
  err: (error) => {
    console.error(JSON.stringify(serializeError(error)));
    process.exit(1);
  },
});
