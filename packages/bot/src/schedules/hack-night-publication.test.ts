import { expect, test } from "bun:test";

import { Result } from "@repo/shared/result";
import { Cron } from "croner";

import type { CmsSyncEvent } from "../integrations/cms.ts";
import { TIME_ZONE } from "../utils/dates.ts";
import { HACK_NIGHT_CALENDAR, thisWeeksHackNight } from "./hack-night-calendar.ts";
import {
  hackNightPublication,
  publicationCandidate,
  publishThisWeeksHackNight,
} from "./hack-night-publication.ts";

const MONDAY = new Date("2026-10-19T12:55:00Z");
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

function harness(records: readonly CmsSyncEvent[] = [EVENT]) {
  const writes: CmsSyncEvent[] = [];
  let reads = 0;
  const cms = {
    listUpcomingEvents: async () => {
      reads++;
      return Result.ok(records);
    },
    publishEventIfUnchanged: async (event: CmsSyncEvent) => {
      writes.push(event);
      return Result.ok(true);
    },
  };
  return { cms, writes, reads: () => reads };
}

test("publishes only the approved event for this week", async () => {
  const check = harness([EVENT, { ...EVENT, id: 219, slug: "7.7", start: "2026-10-31T00:00:00Z" }]);
  expect(Result.isOk(await publishThisWeeksHackNight(check, MONDAY))).toBe(true);
  expect(check.writes.map((event) => event.id)).toEqual([217]);
});

test("an already published event is a no-op", async () => {
  const check = harness([{ ...EVENT, published: true }]);
  expect(Result.isOk(await publishThisWeeksHackNight(check, MONDAY))).toBe(true);
  expect(check.writes).toHaveLength(0);
});

test.each([
  "2026-11-23T13:55:00Z",
  "2026-12-14T13:55:00Z",
  "2026-12-28T13:55:00Z",
  "2027-01-04T13:55:00Z",
  "2027-03-15T12:55:00Z",
  "2027-05-03T12:55:00Z",
  "2027-08-30T12:55:00Z",
])("%s does not jump over a break or infer a future semester", async (at) => {
  const check = harness();
  expect(Result.isOk(await publishThisWeeksHackNight(check, new Date(at)))).toBe(true);
  expect(check.reads()).toBe(0);
  expect(check.writes).toHaveLength(0);
});

const changes: Partial<CmsSyncEvent>[] = [
  { id: 999 },
  { slug: "7.06" },
  { name: "Hack Night 7.7" },
  { eventType: "Special" },
  { location_name: "The Bechtel Center" },
  { start: "2026-10-23T00:00:00Z" },
  { start: "2026-10-24T01:00:00Z" },
  { end: "2026-10-24T07:00:00Z" },
  { start: "invalid" },
  { end: "" },
  { published: undefined },
  { updatedAt: "" },
];
test.each(changes)("changed schedule fields prevent publication: %j", async (change) => {
  const check = harness([{ ...EVENT, ...change }]);
  expect(Result.isError(await publishThisWeeksHackNight(check, MONDAY))).toBe(true);
  expect(check.writes).toHaveLength(0);
});

test.each([{ events: [] }, { events: [EVENT, { ...EVENT, id: 999 }] }])(
  "missing or duplicate events fail closed",
  async ({ events }) => {
    const check = harness(events);
    expect(Result.isError(await publishThisWeeksHackNight(check, MONDAY))).toBe(true);
    expect(check.writes).toHaveLength(0);
  },
);

test("a weekend preview does not advance into next week", () => {
  const now = new Date("2026-10-25T23:00:00Z");
  expect(thisWeeksHackNight(now)?.slug).toBe("7.6");
  expect(publicationCandidate([EVENT], now).unwrap()).toBeUndefined();
  // Sunday night UTC is still Sunday afternoon in Indiana.
  expect(thisWeeksHackNight(new Date("2026-10-19T00:00:00Z"))?.slug).toBe("7.5");
});

test.each([
  ["2026-10-26T12:55:00Z", 219, "2026-10-31T00:00:00Z", "2026-10-31T06:00:00Z"],
  ["2026-11-02T13:55:00Z", 220, "2026-11-07T01:00:00Z", "2026-11-07T07:00:00Z"],
  ["2027-03-08T13:55:00Z", 233, "2027-03-13T01:00:00Z", "2027-03-13T07:00:00Z"],
  ["2027-03-22T12:55:00Z", 234, "2027-03-27T00:00:00Z", "2027-03-27T06:00:00Z"],
  ["2027-04-26T12:55:00Z", 239, "2027-05-01T00:00:00Z", "2027-05-01T06:00:00Z"],
] satisfies [string, number, string, string][])(
  "%s respects DST and the Lite/encore exceptions",
  (at, id, start, end) => {
    const slot = HACK_NIGHT_CALENDAR.find((entry) => entry.id === id);
    if (slot === undefined) throw new Error(`missing test slot ${id}`);
    const event = { ...EVENT, ...slot, start, end };
    expect(publicationCandidate([event], new Date(at)).unwrap()?.id).toBe(id);
  },
);

test("Monday cron stays at 8:55 AM Indiana time across DST", () => {
  const schedule = hackNightPublication(harness());
  const cron = new Cron(schedule.cron, { timezone: TIME_ZONE, paused: true });
  expect(cron.nextRun(new Date("2026-10-25T00:00:00Z"))?.toISOString()).toBe(
    "2026-10-26T12:55:00.000Z",
  );
  expect(cron.nextRun(new Date("2026-11-01T00:00:00Z"))?.toISOString()).toBe(
    "2026-11-02T13:55:00.000Z",
  );
  cron.stop();
});
