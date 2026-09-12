import { expect, test } from "bun:test";

import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } from "discord.js";
import type { GuildScheduledEventCreateOptions } from "discord.js";

import type { CmsSyncEvent } from "../integrations/cms.ts";
import { syncWebsiteEvents, websiteEvent } from "./website-event-sync.ts";
import type { WebsiteEventSyncDeps } from "./website-event-sync.ts";

const NOW = new Date("2026-09-12T13:00:00Z");
const SOURCE: CmsSyncEvent = {
  id: 197,
  name: "Pizza and Chat with Walmart",
  slug: "walmart-f26",
  published: true,
  eventType: "Special",
  start: "2026-09-16T12:00:00-04:00",
  end: "2026-09-16T13:00:00-04:00",
  location_name: "Lawson Computer Science Building",
  description: {
    root: {
      children: [
        { type: "paragraph", children: [{ text: "Pizza " }, { text: "and chat!" }] },
        { type: "paragraph", children: [{ type: "link", children: [{ text: "RSVP today." }] }] },
      ],
    },
  },
};

type ExistingEvent = Awaited<ReturnType<WebsiteEventSyncDeps["events"]["list"]>>[number];

function harness(sources: readonly CmsSyncEvent[], initial: readonly ExistingEvent[] = []) {
  const existing = [...initial];
  const writes: GuildScheduledEventCreateOptions[] = [];
  const deps: WebsiteEventSyncDeps = {
    cms: { listUpcomingPublishedEvents: async () => Result.ok(sources) },
    events: {
      list: async () => [...existing],
      create: async (options) => {
        writes.push(options);
        const event: ExistingEvent = {
          name: options.name,
          description: options.description ?? "",
          scheduledStartTimestamp: new Date(options.scheduledStartTime).getTime(),
        };
        existing.push(event);
        return event;
      },
    },
  };
  return { deps, existing, writes };
}

test("maps the website route, Lexical text, location, and offset timestamps to Discord", () => {
  const event = websiteEvent(SOURCE, NOW);
  expect(event?.sourceUrl).toBe("https://events.purduehackers.com/events/special/walmart-f26");
  expect(event?.options).toMatchObject({
    name: SOURCE.name,
    scheduledStartTime: Date.parse("2026-09-16T16:00:00Z"),
    scheduledEndTime: Date.parse("2026-09-16T17:00:00Z"),
    entityType: GuildScheduledEventEntityType.External,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityMetadata: { location: SOURCE.location_name },
    description:
      "Pizza and chat!\nRSVP today.\n\nhttps://events.purduehackers.com/events/special/walmart-f26#cms-event-197",
  });
});

test("drafts, past events, and events with missing identity or invalid starts never publish", async () => {
  const { deps, writes } = harness([
    { ...SOURCE, published: false },
    { ...SOURCE, published: undefined },
    { ...SOURCE, start: "2026-09-11T13:00:00Z" },
    { ...SOURCE, start: NOW.toISOString() },
    { ...SOURCE, start: "invalid" },
    { ...SOURCE, slug: "" },
    { ...SOURCE, name: " " },
    { ...SOURCE, eventType: "" },
    { ...SOURCE, id: 198 },
  ]);
  expect(Result.isOk(await syncWebsiteEvents(deps, NOW))).toBe(true);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.description).toContain("#cms-event-198");
});

test("a missing or unusable end uses a visibly estimated two-hour duration", () => {
  for (const end of [undefined, "invalid", SOURCE.start]) {
    const event = websiteEvent({ ...SOURCE, end, location_name: "" }, NOW);
    expect(event?.options.scheduledEndTime).toBe(Date.parse("2026-09-16T18:00:00Z"));
    expect(event?.options.description).toContain("End time is estimated");
    expect(event?.options.entityMetadata?.location).toBe("See event website");
  }
});

test("Discord field limits preserve the complete source link and stable identity", () => {
  const event = websiteEvent(
    {
      ...SOURCE,
      name: "n".repeat(200),
      location_name: "l".repeat(200),
      description: "d".repeat(2_000),
    },
    NOW,
  );
  expect(event?.options.name).toHaveLength(100);
  expect(event?.options.entityMetadata?.location).toHaveLength(100);
  expect(event?.options.description).toHaveLength(1_000);
  expect(event?.options.description).toEndWith("/events/special/walmart-f26#cms-event-197");
});

test("repeated runs, repeated source rows, and changed website titles/slugs do not duplicate", async () => {
  const { deps, writes } = harness([SOURCE, SOURCE]);
  await syncWebsiteEvents(deps, NOW);
  await syncWebsiteEvents(deps, NOW);
  await syncWebsiteEvents(
    {
      ...deps,
      cms: {
        listUpcomingPublishedEvents: async () =>
          Result.ok([
            { ...SOURCE, name: "Updated title", slug: "updated-slug", eventType: "workshop" },
          ]),
      },
    },
    NOW,
  );
  expect(writes).toHaveLength(1);
});

test("recognizes existing website links and manually created title/time matches", async () => {
  for (const event of [
    {
      name: "Earlier name",
      description: "RSVP: https://events.purduehackers.com/events/special/walmart-f26/",
      scheduledStartTimestamp: 0,
    },
    {
      name: "  pizza and chat with walmart  ",
      description: "Created by an organizer",
      scheduledStartTimestamp: Date.parse(SOURCE.start ?? ""),
    },
  ]) {
    const { deps, writes } = harness([SOURCE], [event]);
    await syncWebsiteEvents(deps, NOW);
    expect(writes).toHaveLength(0);
  }
});

test("similar links and malformed unrelated URLs do not suppress a missing event", async () => {
  const { deps, writes } = harness(
    [SOURCE],
    [
      {
        name: "Different event",
        description:
          "https://[broken https://events.purduehackers.com/events/special/walmart-f26-extra#cms-event-1970",
        scheduledStartTimestamp: 0,
      },
    ],
  );
  await syncWebsiteEvents(deps, NOW);
  expect(writes).toHaveLength(1);
});

test("a lost create response is reported and the next run discovers the event", async () => {
  const { deps, writes } = harness([SOURCE]);
  const result = await syncWebsiteEvents(
    {
      ...deps,
      events: {
        ...deps.events,
        create: async (options) => {
          await deps.events.create(options);
          throw new Error("response lost after Discord committed");
        },
      },
    },
    NOW,
  );
  expect(Result.isError(result)).toBe(true);
  await syncWebsiteEvents(deps, NOW);
  expect(writes).toHaveLength(1);
});

test("CMS or Discord list failures prevent writes and reach the scheduler", async () => {
  const { deps, writes } = harness([SOURCE]);
  const error = new Transient({ operation: "list CMS", detail: "unavailable" });
  const failedCms = await syncWebsiteEvents(
    { ...deps, cms: { listUpcomingPublishedEvents: async () => Result.err(error) } },
    NOW,
  );
  expect(Result.isError(failedCms)).toBe(true);
  const failedDiscord = await syncWebsiteEvents(
    {
      ...deps,
      events: {
        ...deps.events,
        list: async () => {
          throw new Error("unavailable");
        },
      },
    },
    NOW,
  );
  expect(Result.isError(failedDiscord)).toBe(true);
  expect(writes).toHaveLength(0);
});
