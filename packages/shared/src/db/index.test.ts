import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "vitest";

import { ScheduleType, ScheduledTaskStatus, buildDb, getDb, resetDbForTest } from "./index.ts";

afterEach(() => {
  resetDbForTest();
});

test("getDb is memoized so a long-running process holds one connection", () => {
  const first = getDb({ url: "file::memory:" });
  const second = getDb({ url: "file::memory:" });

  expect(second).toBe(first);
});

test("the first caller's config wins; later ones do not rebuild", () => {
  const first = getDb({ url: "file::memory:" });
  // Deliberately different config: it must be ignored rather than silently
  // opening a second connection to somewhere else.
  const second = getDb({ url: "file::memory:", authToken: "different" });

  expect(second).toBe(first);
});

test("resetDbForTest drops the handle so a test can supply its own", () => {
  const first = getDb({ url: "file::memory:" });
  resetDbForTest();
  const second = getDb({ url: "file::memory:" });

  expect(second).not.toBe(first);
});

test("buildDb accepts a caller-supplied client", () => {
  const db = buildDb(createClient({ url: "file::memory:" }));

  // The schema is attached, so relational queries are reachable.
  expect(db.query.shoppingCarts).toBeDefined();
  expect(db.query.scheduledTasks).toBeDefined();
});

test("enum values match what is already persisted in Turso", () => {
  // These strings are a storage contract: rows on disk carry them. Renaming a
  // value is a migration, not a refactor.
  expect(ScheduleType.Once).toBe("once");
  expect(ScheduleType.Recurring).toBe("recurring");
  expect(ScheduledTaskStatus.Active).toBe("active");
  expect(ScheduledTaskStatus.Cancelled).toBe("cancelled");
  expect(ScheduledTaskStatus.Completed).toBe("completed");
  expect(ScheduledTaskStatus.Failed).toBe("failed");
});
