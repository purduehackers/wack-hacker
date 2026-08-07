import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { buildDb } from "@repo/shared/db";
import { InvariantViolated, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Result as ResultValue } from "@repo/shared/result";

import { createScheduleStore } from "./schedule-store.ts";
import type { ClaimedSchedule, ScheduleOwner } from "./schedule-store.ts";

const CREATE_SCHEDULED_TASKS = `
  CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    description TEXT NOT NULL,
    action_type TEXT DEFAULT 'agent' NOT NULL CHECK (action_type IN ('agent', 'message')),
    prompt TEXT NOT NULL,
    member_roles TEXT,
    schedule_type TEXT NOT NULL,
    cron TEXT,
    timezone TEXT,
    status TEXT DEFAULT 'active' NOT NULL,
    next_run_at TEXT NOT NULL,
    available_at TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at TEXT,
    attempt_count INTEGER DEFAULT 0 NOT NULL CHECK (attempt_count >= 0),
    last_error TEXT,
    last_dispatched_at TEXT,
    fire_count INTEGER DEFAULT 0 NOT NULL CHECK (fire_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (schedule_type = 'once' AND cron IS NULL AND timezone IS NULL)
      OR (schedule_type = 'recurring' AND cron IS NOT NULL AND timezone IS NOT NULL)
    )
  );
  CREATE INDEX scheduled_tasks_due_idx
    ON scheduled_tasks (status, available_at, lease_expires_at);
  CREATE INDEX scheduled_tasks_owner_idx
    ON scheduled_tasks (owner_id, status, created_at);
`;

const owner: ScheduleOwner = {
  ownerId: "10000000000000000",
  channelId: "20000000000000000",
  memberRoles: ["30000000000000000"],
};

interface LocalDatabase {
  readonly client: Client;
  readonly path: string;
  readonly root: string;
}

async function localDatabase(): Promise<LocalDatabase> {
  const root = await mkdtemp(join(tmpdir(), "schedule-store-test-"));
  const path = join(root, "schedules.db");
  const client = createClient({ url: `file:${path}` });
  await client.executeMultiple(CREATE_SCHEDULED_TASKS);
  return { client, path, root };
}

async function closeDatabase(database: LocalDatabase, extraClients: readonly Client[] = []) {
  for (const client of extraClients) client.close();
  database.client.close();
  await rm(database.root, { recursive: true, force: true });
}

function oneTimeStore(client: Client, createdAt: Date, leasePrefix = "lease") {
  let lease = 0;
  return createScheduleStore({
    db: buildDb(client),
    now: () => createdAt,
    newId: () => "00000000-0000-4000-8000-000000000001",
    newLeaseToken: () => `${leasePrefix}-${(lease += 1)}`,
  });
}

type ClientRow = Awaited<ReturnType<Client["execute"]>>["rows"][number];
type RowMutation = (row: ClientRow) => void;

function mutatingClient(client: Client, mutate: RowMutation): Client {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return async (...input: Parameters<Client["execute"]>) => {
        const result = await target.execute(...input);
        for (const row of result.rows) mutate(row);
        return result;
      };
    },
  });
}

async function rawTask(client: Client) {
  const result = await client.execute("SELECT * FROM scheduled_tasks");
  const row = result.rows[0];
  if (row === undefined) throw new Error("expected one scheduled task row");
  return row;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`expected string ${name}`);
  return value;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number") throw new Error(`expected number ${name}`);
  return value;
}

function expectOk<T, E>(result: ResultValue<T, E>): T {
  expect(Result.isOk(result)).toBeTrue();
  if (Result.isError(result)) throw result.error;
  return result.value;
}

async function claimAt(
  store: ReturnType<typeof oneTimeStore>,
  at: Date,
  leaseForMs = 60_000,
): Promise<ClaimedSchedule | undefined> {
  const result = await store.claimDue({ now: at, limit: 10, leaseForMs });
  return expectOk(result)[0];
}

describe("schedule store row normalization", () => {
  test("does not expose SQL NULL in task views or claims", async () => {
    const database = await localDatabase();
    try {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const dueAt = new Date("2026-01-01T00:01:00.000Z");
      const store = oneTimeStore(database.client, createdAt);
      const created = expectOk(
        await store.create(owner, {
          type: "once",
          description: "Normalize SQL NULL",
          prompt: "Dispatch without nullable fields",
          runAt: dueAt,
        }),
      );

      expect(created).not.toHaveProperty("cron");
      expect(created).not.toHaveProperty("timezone");
      expect(created).not.toHaveProperty("lastError");
      expect(created).not.toHaveProperty("lastDispatchedAt");

      await database.client.execute("UPDATE scheduled_tasks SET member_roles = NULL");
      const claimed = await claimAt(store, dueAt);
      if (claimed === undefined) throw new Error("expected normalized claim");
      expect(claimed).not.toHaveProperty("cron");
      expect(claimed).not.toHaveProperty("timezone");
      expect(claimed).not.toHaveProperty("memberRoles");
    } finally {
      await closeDatabase(database);
    }
  });
});

const malformedViewCases: ReadonlyArray<readonly [string, string, RowMutation]> = [
  ["missing column", "id", (row) => delete row["id"]],
  ["wrong string type", "description", (row) => (row["description"] = 42)],
  ["unknown action", "actionType", (row) => (row["actionType"] = "email")],
  ["unknown status", "status", (row) => (row["status"] = "unknown")],
  ["negative counter", "fireCount", (row) => (row["fireCount"] = -1)],
  ["fractional counter", "fireCount", (row) => (row["fireCount"] = 1.5)],
  ["unsafe counter", "fireCount", (row) => (row["fireCount"] = Number.MAX_SAFE_INTEGER + 1)],
  ["mismatched once shape", "scheduleType", (row) => (row["cron"] = "* * * * *")],
  ["mismatched recurring shape", "scheduleType", (row) => (row["scheduleType"] = "recurring")],
  ["extra column", "row", (row) => (row["unexpected"] = "value")],
];

const malformedClaimCases: ReadonlyArray<readonly [string, string, RowMutation]> = [
  ["invalid member-role JSON", "memberRoles", (row) => (row["memberRoles"] = "{")],
  ["non-string member role", "memberRoles", (row) => (row["memberRoles"] = '["role", 42]')],
  ["wrong lease-token type", "leaseToken", (row) => (row["leaseToken"] = 42)],
  ["negative attempt counter", "attemptCount", (row) => (row["attemptCount"] = -1)],
  ["fractional attempt counter", "attemptCount", (row) => (row["attemptCount"] = 1.5)],
  [
    "unsafe attempt counter",
    "attemptCount",
    (row) => (row["attemptCount"] = Number.MAX_SAFE_INTEGER + 1),
  ],
  ["mismatched once claim", "scheduleType", (row) => (row["cron"] = "* * * * *")],
  ["mismatched recurring claim", "scheduleType", (row) => (row["scheduleType"] = "recurring")],
];

function expectRowInvariant(result: ResultValue<unknown, unknown>, field: string): void {
  expect(Result.isError(result)).toBeTrue();
  if (Result.isOk(result)) throw new Error("expected malformed row failure");
  expect(InvariantViolated.is(result.error)).toBeTrue();
  if (!InvariantViolated.is(result.error)) throw new Error("expected InvariantViolated");
  expect(result.error.detail).toContain(field);
}

describe("schedule store errors", () => {
  test.each(malformedViewCases)(
    "rejects malformed task view: %s",
    async (_label, field, mutate) => {
      const database = await localDatabase();
      try {
        const createdAt = new Date("2026-01-01T00:00:00.000Z");
        const store = oneTimeStore(database.client, createdAt);
        expectOk(
          await store.create(owner, {
            type: "once",
            description: "Malformed row",
            prompt: "Never dispatch",
            runAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
        );
        const malformedStore = oneTimeStore(mutatingClient(database.client, mutate), createdAt);

        expectRowInvariant(await malformedStore.list(owner), field);
      } finally {
        await closeDatabase(database);
      }
    },
  );

  test.each(malformedClaimCases)("rejects malformed claim: %s", async (_label, field, mutate) => {
    const database = await localDatabase();
    try {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const dueAt = new Date("2026-01-01T00:01:00.000Z");
      const store = oneTimeStore(database.client, createdAt);
      expectOk(
        await store.create(owner, {
          type: "once",
          description: "Malformed claim",
          prompt: "Never dispatch",
          runAt: dueAt,
        }),
      );
      const malformedStore = oneTimeStore(mutatingClient(database.client, mutate), createdAt);

      expectRowInvariant(
        await malformedStore.claimDue({ now: dueAt, limit: 1, leaseForMs: 60_000 }),
        field,
      );
    } finally {
      await closeDatabase(database);
    }
  });

  test("returns InvariantViolated when lease-token generation fails", async () => {
    const database = await localDatabase();
    try {
      const store = createScheduleStore({
        db: buildDb(database.client),
        newLeaseToken: () => {
          throw new Error("entropy unavailable");
        },
      });

      const result = await store.claimDue({
        now: new Date("2026-01-01T00:01:00.000Z"),
        limit: 1,
        leaseForMs: 60_000,
      });

      expect(Result.isError(result)).toBeTrue();
      if (Result.isOk(result)) throw new Error("expected lease-token generation failure");
      expect(InvariantViolated.is(result.error)).toBeTrue();
    } finally {
      await closeDatabase(database);
    }
  });

  test("returns Transient when libSQL execution fails", async () => {
    const database = await localDatabase();
    try {
      const store = oneTimeStore(database.client, new Date("2026-01-01T00:00:00.000Z"));
      await database.client.execute("DROP TABLE scheduled_tasks");

      const result = await store.list(owner);

      expect(Result.isError(result)).toBeTrue();
      if (Result.isOk(result)) throw new Error("expected database failure");
      expect(Transient.is(result.error)).toBeTrue();
      if (!Transient.is(result.error)) throw new Error("expected Transient");
      expect(result.error.operation).toBe("list scheduled tasks");
    } finally {
      await closeDatabase(database);
    }
  });
});

describe("durable schedule leases", () => {
  test("overlapping libSQL dispatchers claim once and an expired lease is recoverable", async () => {
    const database = await localDatabase();
    const secondClient = createClient({ url: `file:${database.path}` });
    try {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const dueAt = new Date("2026-01-01T00:01:00.000Z");
      const firstStore = oneTimeStore(database.client, createdAt, "first");
      const secondStore = oneTimeStore(secondClient, createdAt, "second");
      expectOk(
        await firstStore.create(owner, {
          type: "once",
          description: "Atomic lease",
          prompt: "Run once",
          runAt: dueAt,
        }),
      );

      const overlappingResults = await Promise.all([
        firstStore.claimDue({ now: dueAt, limit: 10, leaseForMs: 60_000 }),
        secondStore.claimDue({ now: dueAt, limit: 10, leaseForMs: 60_000 }),
      ]);
      const overlapping = overlappingResults.flatMap(expectOk);
      expect(overlapping).toHaveLength(1);
      const firstClaim = overlapping[0];
      if (firstClaim === undefined) throw new Error("expected an initial claim");

      expect(await claimAt(secondStore, new Date(dueAt.getTime() + 59_999))).toBeUndefined();
      const recovered = await claimAt(secondStore, new Date(dueAt.getTime() + 60_000));
      if (recovered === undefined) throw new Error("expected an expired lease to be reclaimed");
      expect(recovered.occurrenceId).toBe(firstClaim.occurrenceId);
      expect(recovered.leaseToken).not.toBe(firstClaim.leaseToken);

      expect(expectOk(await firstStore.complete(firstClaim, dueAt))).toBeFalse();
      expect(expectOk(await secondStore.complete(recovered, dueAt))).toBeTrue();
      const row = await rawTask(database.client);
      expect(row["status"]).toBe("completed");
      expect(requiredNumber(row["fire_count"], "fire_count")).toBe(1);
    } finally {
      await closeDatabase(database, [secondClient]);
    }
  });

  test("stale failure settlement cannot claim that it made a terminal transition", async () => {
    const database = await localDatabase();
    try {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const dueAt = new Date("2026-01-01T00:01:00.000Z");
      const store = oneTimeStore(database.client, createdAt);
      expectOk(
        await store.create(owner, {
          type: "once",
          description: "CAS settlement",
          prompt: "Run once",
          runAt: dueAt,
        }),
      );
      const claim = await claimAt(store, dueAt);
      if (claim === undefined) throw new Error("expected a claim");
      expect(expectOk(await store.complete(claim, dueAt))).toBeTrue();

      const stale = expectOk(
        await store.fail({ ...claim, attemptCount: 4 }, new Error("late"), dueAt),
      );
      expect(stale).toEqual({ attemptCount: 5, settled: false, terminal: false });
      expect((await rawTask(database.client))["status"]).toBe("completed");
    } finally {
      await closeDatabase(database);
    }
  });
});

describe("durable schedule retries", () => {
  test("backs off 1/2/4/8 minutes, keeps one occurrence id, then stops at five attempts", async () => {
    const database = await localDatabase();
    try {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      let eligibleAt = new Date("2026-01-01T00:01:00.000Z");
      const store = oneTimeStore(database.client, createdAt);
      expectOk(
        await store.create(owner, {
          type: "once",
          description: "Retry policy",
          prompt: "Eventually work",
          runAt: eligibleAt,
        }),
      );

      let occurrenceId: string | undefined;
      const backoffs = [1, 2, 4, 8] as const;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claim = await claimAt(store, eligibleAt);
        if (claim === undefined) throw new Error(`expected claim ${attempt}`);
        occurrenceId ??= claim.occurrenceId;
        expect(claim.occurrenceId).toBe(occurrenceId);
        expect(claim.attemptCount).toBe(attempt - 1);

        const outcome = expectOk(
          await store.fail(claim, new Error(`failure ${attempt}`), eligibleAt),
        );
        expect(outcome).toEqual({
          attemptCount: attempt,
          settled: true,
          terminal: attempt === 5,
        });
        const row = await rawTask(database.client);
        expect(requiredNumber(row["attempt_count"], "attempt_count")).toBe(attempt);
        expect(row["last_error"]).toBe(`failure ${attempt}`);

        if (attempt === 5) {
          expect(row["status"]).toBe("failed");
          expect(
            await claimAt(store, new Date(eligibleAt.getTime() + 24 * 60 * 60_000)),
          ).toBeUndefined();
        } else {
          const delayMinutes = backoffs[attempt - 1];
          if (delayMinutes === undefined) throw new Error("missing retry delay");
          const nextAt = new Date(eligibleAt.getTime() + delayMinutes * 60_000);
          expect(requiredString(row["available_at"], "available_at")).toBe(nextAt.toISOString());
          expect(await claimAt(store, new Date(nextAt.getTime() - 1))).toBeUndefined();
          eligibleAt = nextAt;
        }
      }
    } finally {
      await closeDatabase(database);
    }
  });
});

describe("recurring schedules across DST", () => {
  test("advances from the occurrence anchor and preserves the local wall-clock hour", async () => {
    const database = await localDatabase();
    try {
      const createdAt = new Date("2026-03-06T15:00:00.000Z");
      const store = oneTimeStore(database.client, createdAt);
      const created = expectOk(
        await store.create(owner, {
          type: "recurring",
          description: "Daily standup",
          prompt: "Post the standup prompt",
          cron: "0 9 * * *",
          timezone: "America/New_York",
        }),
      );
      expect(created.nextRunAt).toBe("2026-03-07T14:00:00.000Z");

      const first = await claimAt(store, new Date(created.nextRunAt));
      if (first === undefined) throw new Error("expected the pre-DST occurrence");
      // Completion is deliberately late. The recurrence must still advance from
      // the scheduled anchor, not skip ahead from this wall clock.
      expectOk(await store.complete(first, new Date("2026-03-09T16:00:00.000Z")));
      let row = await rawTask(database.client);
      expect(row["next_run_at"]).toBe("2026-03-08T13:00:00.000Z");

      const second = await claimAt(store, new Date("2026-03-09T16:00:00.000Z"));
      if (second === undefined) throw new Error("expected the DST occurrence");
      expect(second.occurrenceId).not.toBe(first.occurrenceId);
      expectOk(await store.complete(second, new Date("2026-03-09T16:00:00.000Z")));
      row = await rawTask(database.client);
      expect(row["next_run_at"]).toBe("2026-03-09T13:00:00.000Z");
      expect(requiredNumber(row["fire_count"], "fire_count")).toBe(2);
    } finally {
      await closeDatabase(database);
    }
  });
});
