import { expect, test } from "bun:test";

import type { CmsEventSummary } from "./cms.ts";
import { describeEvent, rankEvents } from "./event-directory.ts";

function event(name: string, slug: string, start?: string, published?: boolean): CmsEventSummary {
  return {
    id: slug,
    name,
    slug,
    ...(start !== undefined && { start }),
    ...(published !== undefined && { published }),
  };
}

const HACK_NIGHT_95 = event("Hack Night 9.5", "hack-night-9.5", "2026-08-28T00:00:00.000Z");

const EVENTS: readonly CmsEventSummary[] = [
  HACK_NIGHT_95,
  event("Hack Night 9.4", "hack-night-9.4", "2026-08-21T00:00:00.000Z"),
  event("Sound Galaxy Workshop", "sound-galaxy-workshop", "2026-08-14T00:00:00.000Z"),
  event("Metagalaxy Demo Day", "metagalaxy-demo-day", "2026-09-04T00:00:00.000Z"),
  event("Undated Idea", "undated-idea"),
];

/**
 * The option is focused before anything is typed, so the empty query is the
 * common case — and an organizer filing tonight's photos wants the newest event,
 * not the alphabetically first one.
 */
test("an empty query offers the most recent events first", () => {
  const ranked = rankEvents(EVENTS, "");

  expect(ranked.map((entry) => entry.slug)).toEqual([
    "metagalaxy-demo-day",
    "hack-night-9.5",
    "hack-night-9.4",
    "sound-galaxy-workshop",
    "undated-idea",
  ]);
});

/** Typing a word means that word, not any string containing those letters. */
test("a word-boundary match outranks a mid-word one", () => {
  const ranked = rankEvents(EVENTS, "galaxy");

  expect(ranked.map((entry) => entry.slug)).toEqual([
    "sound-galaxy-workshop",
    "metagalaxy-demo-day",
  ]);
});

test("the slug matches as well as the name, and non-matches are dropped", () => {
  expect(rankEvents(EVENTS, "hack-night-9.4").map((entry) => entry.slug)).toEqual([
    "hack-night-9.4",
  ]);
  expect(rankEvents(EVENTS, "nothing here")).toHaveLength(0);
});

/** Discord rejects a response carrying more than 25 choices. */
test("the list is capped", () => {
  const many = Array.from({ length: 40 }, (_, index) =>
    event(
      `Hack Night ${index}`,
      `hack-night-${index}`,
      `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    ),
  );

  expect(rankEvents(many, "")).toHaveLength(25);
  expect(rankEvents(many, "hack")).toHaveLength(25);
});

/**
 * Three years of `Hack Night` are indistinguishable without the date, and filing
 * photos to an unpublished event is normal — doing it by accident is not.
 */
test("a suggestion reads as its name, date, and draft state", () => {
  // Midnight UTC is the evening before in Indiana, which is the clock an
  // organizer reads the list on.
  expect(describeEvent(HACK_NIGHT_95)).toBe("Hack Night 9.5 — Aug 27, 2026");
  expect(describeEvent(event("Draft Thing", "draft-thing", undefined, false))).toBe(
    "Draft Thing (draft)",
  );
  expect(describeEvent(event("Undated", "undated"))).toBe("Undated");
});
