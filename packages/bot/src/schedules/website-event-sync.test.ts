import { expect, test } from "bun:test";

import { UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import type { CmsSyncEvent } from "../integrations/cms.ts";
import { nextHackNightToPublish, syncWebsiteEvents } from "./website-event-sync.ts";
import type { WebsiteEventSyncDeps } from "./website-event-sync.ts";

const NOW = new Date("2026-10-19T13:00:00Z");
const EVENT: CmsSyncEvent = {
  id: 217,
  slug: "7.6",
  name: "Hack Night 7.6",
  eventType: "hack-night",
  start: "2026-10-24T00:00:00.000Z",
  end: "2026-10-24T06:00:00.000Z",
  location_name: "HIVE (BHEE 270/280)",
  published: false,
  updatedAt: "2026-10-11T21:33:00.000Z",
};

test.each([
  "Hack Night 7.6",
  "hacknight 7.25.1",
  "  HACK NIGHT 7.01  ",
  "Hack Night 7.6: Halloween",
])("publishes versioned name %s", (name) => {
  expect(nextHackNightToPublish([{ ...EVENT, name }], NOW)?.id).toBe(217);
});

test.each([
  "Hack Lite",
  "Hack Night",
  "Hack Night 7",
  "Hack Night 7.6beta",
  "Hack Night 7.6.1.2",
  "Workshop about Hack Night 7.6",
])("does not match %s", (name) => {
  expect(nextHackNightToPublish([{ ...EVENT, name }], NOW)).toBeUndefined();
});

test("only the earliest matching event can publish, regardless of input order", () => {
  const later = { ...EVENT, id: 219, start: "2026-10-25T00:00:00Z" };
  expect(nextHackNightToPublish([later, EVENT], NOW)?.id).toBe(217);
  expect(nextHackNightToPublish([later, { ...EVENT, published: true }], NOW)).toBeUndefined();
});

test.each(["2026-10-18T00:00:00Z", "2026-10-19T13:00:00Z", "2026-10-26T13:00:01Z", "invalid"])(
  "past, invalid, or more-than-seven-day start %s is skipped",
  (start) => {
    expect(nextHackNightToPublish([{ ...EVENT, start }], NOW)).toBeUndefined();
  },
);

test("a break does not publish the event two weeks away", () => {
  const afterBreak = { ...EVENT, start: "2027-03-27T00:00:00Z" };
  expect(nextHackNightToPublish([afterBreak], new Date("2027-03-15T13:00:00Z"))).toBeUndefined();
});

test("selection uses CMS dates and regex rather than a semester, ID, or venue allowlist", () => {
  const nextYear = {
    ...EVENT,
    id: 999,
    name: "Hack Night 8.2",
    start: "2027-10-23T00:00:00Z",
    location_name: "New venue",
  };
  expect(nextHackNightToPublish([nextYear], new Date("2027-10-18T13:00:00Z"))?.id).toBe(999);
});

function harness(records: readonly CmsSyncEvent[] = [EVENT], rejectPublication = false) {
  let stored = structuredClone(records);
  const operations: string[] = [];
  const existing: { name: string; description: string; scheduledStartTimestamp: number }[] = [];
  const deps: WebsiteEventSyncDeps = {
    cms: {
      listUpcomingEvents: async () => {
        operations.push("cms-upcoming");
        return Result.ok(structuredClone(stored));
      },
      publishEventIfUnchanged: async (source) => {
        operations.push("cms-publish");
        if (rejectPublication) {
          return Result.err(
            new UpstreamError({ service: "payload-cms", status: 403, detail: "refused" }),
          );
        }
        stored = stored.map((row) => (row.id === source.id ? { ...row, published: true } : row));
        return Result.ok(true);
      },
      listUpcomingPublishedEvents: async () => {
        operations.push("cms-published");
        return Result.ok(structuredClone(stored.filter((row) => row.published)));
      },
    },
    events: {
      list: async () => {
        operations.push("discord-list");
        return existing;
      },
      create: async (options) => {
        operations.push("discord-create");
        const created = {
          name: options.name,
          description: options.description ?? "",
          scheduledStartTimestamp: new Date(options.scheduledStartTime).getTime(),
        };
        existing.push(created);
        return created;
      },
    },
  };
  return { deps, operations, existing };
}

test("publication completes before the same run reads and creates Discord events", async () => {
  const check = harness();
  expect(Result.isOk(await syncWebsiteEvents(check.deps, NOW))).toBe(true);
  expect(check.operations).toEqual([
    "cms-upcoming",
    "cms-publish",
    "cms-published",
    "discord-list",
    "discord-create",
  ]);
  expect(check.existing[0]?.name).toBe("Hack Night 7.6");
  await syncWebsiteEvents(check.deps, NOW);
  expect(check.operations.filter((operation) => operation === "cms-publish")).toHaveLength(1);
  expect(check.operations.filter((operation) => operation === "discord-create")).toHaveLength(1);
});

test("a failed publication stops the sync and reports the failure", async () => {
  const check = harness([EVENT], true);
  expect(Result.isError(await syncWebsiteEvents(check.deps, NOW))).toBe(true);
  expect(check.operations).toEqual(["cms-upcoming", "cms-publish"]);
});

test("other published events still sync when no Hack Night needs publication", async () => {
  const check = harness([
    { ...EVENT, name: "Rust workshop", eventType: "workshop", published: true },
  ]);
  expect(Result.isOk(await syncWebsiteEvents(check.deps, NOW))).toBe(true);
  expect(check.operations).toEqual([
    "cms-upcoming",
    "cms-published",
    "discord-list",
    "discord-create",
  ]);
});
