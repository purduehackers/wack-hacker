import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionAuditEntry } from "./types.ts";

// Route libsql to an in-memory SQLite so drizzle hits a real (ephemeral) DB.
const { memoryClient } = await vi.hoisted(async () => {
  const actual = await import("@libsql/client");
  return { memoryClient: actual.createClient({ url: "file::memory:?cache=shared" }) };
});

vi.mock("@libsql/client", async () => {
  const actual = await vi.importActual<typeof import("@libsql/client")>("@libsql/client");
  return {
    ...actual,
    createClient: vi.fn(() => memoryClient),
  };
});

const { buildDb, getDb } = await import("../../db/index.ts");
const { actionAudit } = await import("../../db/schemas/action-audit.ts");
const { AuditLog, hashInput, previewInput } = await import("./audit.ts");

beforeAll(async () => {
  const migrationsDir = "./drizzle";
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrationFiles) {
    const raw = readFileSync(join(migrationsDir, migration), "utf-8");
    for (const statement of raw.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await memoryClient.execute(trimmed);
    }
  }
});

beforeEach(async () => {
  await getDb().delete(actionAudit);
});

function entry(overrides: Partial<ActionAuditEntry> = {}): ActionAuditEntry {
  return {
    userId: "u-1",
    role: "organizer",
    source: "chat",
    delegate: "github",
    tool: "delete_repository",
    risk: "destructive",
    input: { repo: "wack-hacker" },
    reason: "cleanup",
    decision: "requested",
    ...overrides,
  };
}

describe("AuditLog.record", () => {
  it("appends a row with hashed input and preview", async () => {
    await new AuditLog().record(entry());

    const rows = await getDb().select().from(actionAudit);
    expect(rows).toHaveLength(1);
    const inserted = rows[0]!;
    expect(inserted.userId).toBe("u-1");
    expect(inserted.role).toBe("organizer");
    expect(inserted.source).toBe("chat");
    expect(inserted.delegate).toBe("github");
    expect(inserted.tool).toBe("delete_repository");
    expect(inserted.risk).toBe("destructive");
    expect(inserted.decision).toBe("requested");
    expect(inserted.reason).toBe("cleanup");
    expect(inserted.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted.inputPreview).toBe('{"repo":"wack-hacker"}');
    expect(inserted.decidedBy).toBeNull();
    expect(new Date(inserted.at).getTime()).not.toBeNaN();
  });

  it("gives identical inputs identical hashes, distinct inputs distinct ones", async () => {
    const log = new AuditLog();
    await log.record(entry({ decision: "requested" }));
    await log.record(entry({ decision: "approved", decidedBy: "u-2" }));
    await log.record(entry({ input: { repo: "other" } }));

    const rows = await getDb().select().from(actionAudit);
    expect(rows).toHaveLength(3);
    const hashes = rows.map((r) => r.inputHash);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
    expect(rows[1]!.decidedBy).toBe("u-2");
  });

  it("never throws when the database is unusable", async () => {
    const actual = await vi.importActual<typeof import("@libsql/client")>("@libsql/client");
    // Fresh in-memory db with NO migrations — the insert fails on a missing
    // table and record() must swallow it.
    const bare = buildDb(actual.createClient({ url: ":memory:" }));
    await expect(new AuditLog(bare).record(entry())).resolves.toBeUndefined();
  });
});

describe("hashInput / previewInput", () => {
  it("hashes null-ish input stably", () => {
    expect(hashInput(undefined)).toBe(hashInput(null));
    expect(hashInput(undefined)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("truncates long previews with an ellipsis", () => {
    const long = { text: "x".repeat(500) };
    const preview = previewInput(long);
    expect(preview.length).toBe(300);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("handles unserializable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(previewInput(circular)).toBe("<unserializable>");
    expect(hashInput(circular)).toMatch(/^[0-9a-f]{64}$/);
  });
});
