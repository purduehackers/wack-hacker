import { expect, test } from "bun:test";

import { Result } from "@repo/shared/result";

import { MediaSource } from "./cms.ts";
import { altTextFor, decodeDrop, hackNightDrop, resolveDrop } from "./image-drop.ts";
import type { ImageDrop, ImageDropStore } from "./image-drop.ts";

const EVENT = { id: 42, slug: "sound-galaxy-workshop", name: "Sound Galaxy Workshop" };

const LINKED: ImageDrop = {
  batchId: EVENT.slug,
  source: MediaSource.Drop,
  label: EVENT.name,
  event: EVENT,
};

/** Upstash parses stored JSON on the way out, so a record set as an object returns as one. */
test("a linked drop decodes to exactly what was stored", () => {
  expect(decodeDrop(structuredClone(LINKED))).toEqual(LINKED);
});

/**
 * The pre-drop key held a bare slug. Deploying mid-hack-night would otherwise
 * orphan the live photo thread, and uploads would fall back to the *message's*
 * date — which splits the archive the moment the night crosses midnight.
 */
test("a legacy slug decodes as an unlinked hack night drop", () => {
  expect(decodeDrop("hack-night-2026-08-28")).toEqual({
    batchId: "hack-night-2026-08-28",
    source: MediaSource.HackNight,
    label: "Hack Night 2026-08-28",
  });
});

/** A thread with nothing stored is not a drop; neither is one holding junk. */
test("unusable values decode to nothing", () => {
  expect(decodeDrop(undefined)).toBeUndefined();
  expect(decodeDrop("")).toBeUndefined();
  expect(decodeDrop({ batchId: "x", source: "manual", label: "x" })).toBeUndefined();
});

function storeHolding(drop?: ImageDrop): ImageDropStore {
  return {
    set: () => Promise.resolve(Result.ok(undefined)),
    get: () => Promise.resolve(Result.ok(drop)),
  };
}

test("a stored drop wins over the fallback", async () => {
  const fallback = hackNightDrop(new Date("2026-08-28T21:00:00Z"));
  const resolved = await resolveDrop(storeHolding(LINKED), "thread-1", fallback);

  expect(resolved.batchId).toBe(EVENT.slug);
  expect(resolved.event?.id).toBe(EVENT.id);
});

test("an unrecorded thread resolves to the fallback", async () => {
  const fallback = hackNightDrop(new Date("2026-08-28T21:00:00Z"));

  expect(await resolveDrop(storeHolding(), "thread-2", fallback)).toEqual(fallback);
});

/** The archive's alt text is public, so its wording is not incidental. */
test("alt text keeps the wording the archive has always used", () => {
  const drop = hackNightDrop(new Date("2026-08-28T21:00:00Z"));

  expect(altTextFor(drop, "123-photo.png")).toBe("Hack Night 2026-08-28 photo — 123-photo.png");
  expect(altTextFor(LINKED, "123-photo.png")).toBe("Sound Galaxy Workshop photo — 123-photo.png");
});
