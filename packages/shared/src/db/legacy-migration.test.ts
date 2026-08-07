import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";

const LEGACY_RESHAPE_AT = 1_786_039_312_446;
const ACTION_REMEDIATION_AT = 1_786_065_744_130;
const ROLE_REMEDIATION_AT = 1_786_068_148_719;
const directory = mkdtempSync(join(tmpdir(), "wack-legacy-migration-"));
let client: Client;

async function applyMigration(createdAt: number): Promise<void> {
  const migration = readMigrationFiles({
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  }).find(({ folderMillis }) => folderMillis === createdAt);
  if (migration === undefined) throw new Error(`migration ${createdAt} is missing`);
  for (const sql of migration.sql) await client.execute(sql);
}

beforeAll(async () => {
  client = createClient({ url: `file:${join(directory, "legacy.db")}` });
  const legacy = readMigrationFiles({
    migrationsFolder: new URL("../../drizzle", import.meta.url).pathname,
  }).filter(({ folderMillis }) => folderMillis < LEGACY_RESHAPE_AT);
  for (const migration of legacy) {
    for (const sql of migration.sql) await client.execute(sql);
  }
  await client.execute({
    sql: `
      INSERT INTO scheduled_tasks (
        id, user_id, channel_id, description, schedule_type, run_at, cron, timezone,
        action, member_roles, status, next_run_at, fire_count, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 'once', ?, NULL, NULL, ?, ?, 'active', ?, 0, ?, ?),
        (?, ?, ?, ?, 'recurring', NULL, ?, ?, ?, ?, 'active', ?, 2, ?, ?)
    `,
    args: [
      "agent-1",
      "10000000000000000",
      "30000000000000000",
      "agent job",
      "2030-01-01T00:00:00.000Z",
      JSON.stringify({
        type: "agent",
        channelId: "31000000000000000",
        prompt: "summarize today",
      }),
      JSON.stringify(["20000000000000000"]),
      "2030-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "message-1",
      "10000000000000001",
      "30000000000000001",
      "message job",
      "0 9 * * 1",
      "America/Indiana/Indianapolis",
      JSON.stringify({
        type: "message",
        channelId: "32000000000000000",
        content: "standup now",
      }),
      JSON.stringify([]),
      "2030-01-02T14:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ],
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const baseline = Bun.spawn(
      [
        process.execPath,
        new URL("../../scripts/baseline-legacy-migrations.ts", import.meta.url).pathname,
      ],
      {
        cwd: new URL("../..", import.meta.url).pathname,
        env: { ...process.env, TURSO_DATABASE_URL: `file:${join(directory, "legacy.db")}` },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const baselineExit = await baseline.exited;
    if (baselineExit !== 0) {
      throw new Error(`legacy baseline failed: ${await new Response(baseline.stderr).text()}`);
    }
  }
  await applyMigration(LEGACY_RESHAPE_AT);
  await applyMigration(ACTION_REMEDIATION_AT);
  await applyMigration(ROLE_REMEDIATION_AT);
});

afterAll(() => {
  client.close();
  rmSync(directory, { force: true, recursive: true });
});

describe("legacy scheduled-task migration", () => {
  test("preserves action semantics, destination, and role snapshot", async () => {
    const result = await client.execute(`
      SELECT id, channel_id, action_type, prompt, member_roles, schedule_type, cron, timezone,
             status, fire_count
      FROM scheduled_tasks
      ORDER BY id
    `);
    const rows: unknown = result.rows.map((record) => ({ ...record }));
    expect(rows).toEqual([
      {
        id: "agent-1",
        channel_id: "31000000000000000",
        action_type: "agent",
        prompt: "summarize today",
        member_roles: JSON.stringify(["20000000000000000"]),
        schedule_type: "once",
        // oxlint-disable-next-line unicorn/no-null -- SQL NULL is the value under migration test.
        cron: null,
        // oxlint-disable-next-line unicorn/no-null -- SQL NULL is the value under migration test.
        timezone: null,
        status: "active",
        fire_count: 0,
      },
      {
        id: "message-1",
        channel_id: "32000000000000000",
        action_type: "message",
        prompt: "standup now",
        member_roles: JSON.stringify([]),
        schedule_type: "recurring",
        cron: "0 9 * * 1",
        timezone: "America/Indiana/Indianapolis",
        status: "active",
        fire_count: 2,
      },
    ]);
  });
});
