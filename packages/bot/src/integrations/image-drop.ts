/**
 * Image drops: a Discord thread whose images are filed into the CMS archive.
 *
 * A drop is the join between a thread and the archive. It carries the `batchId`
 * every upload is tagged with, the `source` that batch is filed under, and — when
 * an organizer pointed the thread at a CMS event — the event those images should
 * also be attached to.
 *
 * The weekly hack night is one drop among others. It is the one that can be
 * *derived*: its batch id is `hack-night-YYYY-MM-DD`, dated to the Friday it
 * started, so a photo thread whose Redis record was lost still files under the
 * slug a human would guess. Every other drop exists only because `/image-drop`
 * created it, so a missing record there means the thread is not a drop at all.
 *
 * The record is stored rather than recomputed because the cleanup job runs on
 * Sunday and would otherwise have to work backwards to Friday's date. The stored
 * value is also authoritative in the one case derivation gets wrong: a hack night
 * that ran past midnight is still dated to when it started.
 *
 * The thirty-day TTL outlives both the Friday-to-Sunday window and the stragglers
 * who post photos days after an event, while keeping the keyspace bounded.
 */

import { messageOf, Transient } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { z } from "zod";

import { calendarDate } from "../utils/dates.ts";
import { MediaSource } from "./cms.ts";
import type { CmsEvent, MediaBatch } from "./cms.ts";

const DROP_TTL_SECONDS = 30 * 24 * 60 * 60;

const dropKey = (threadId: string) => `image-drop:${threadId}`;

/**
 * The pre-drop key, read but never written.
 *
 * It held a bare slug string for the week's photo thread. Deploying this while a
 * hack night is in progress would otherwise orphan that thread mid-event, and
 * uploads would fall back to the *message's* date — which splits the archive in
 * two the moment the night crosses midnight.
 */
const legacyKey = (threadId: string) => `hack-night-thread:${threadId}`;

export interface ImageDrop extends MediaBatch {
  /** Human name for the batch, used as the stem of every image's alt text. */
  readonly label: string;
  /** The CMS event to attach uploads to, when the drop is linked to one. */
  readonly event?: CmsEvent;
}

const dropSchema = z.strictObject({
  batchId: z.string().min(1),
  source: z.enum([MediaSource.HackNight, MediaSource.Drop]),
  label: z.string().min(1),
  event: z
    .strictObject({
      id: z.union([z.string(), z.number()]),
      slug: z.string(),
      name: z.string(),
    })
    .optional(),
});

/** The weekly photo thread's name, which is also how the upload handler finds it. */
export const HACK_NIGHT_THREAD_PREFIX = "Hack Night Images";

export function generateEventSlug(date: Date): string {
  const { year, month, day } = calendarDate(date);
  return `hack-night-${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `Hack Night 2026-08-28`, the wording the archive's alt text has always used. */
function hackNightLabel(batchId: string): string {
  return `Hack Night ${batchId.replace(/^hack-night-/, "")}`;
}

/** The unlinked hack night drop for a date — what an unrecorded photo thread is. */
export function hackNightDrop(date: Date): ImageDrop {
  const batchId = generateEventSlug(date);
  return { batchId, source: MediaSource.HackNight, label: hackNightLabel(batchId) };
}

/** Alt text is required by the CMS, so every upload gets one derived the same way. */
export function altTextFor(drop: ImageDrop, filename: string): string {
  return `${drop.label} photo — ${filename}`;
}

/** Narrowed to the two commands this store issues, which is also what a test needs. */
export type DropRedis = Pick<RedisClient, "get" | "set">;

export interface ImageDropStore {
  readonly set: (threadId: string, drop: ImageDrop) => Promise<Result<undefined, Transient>>;
  readonly get: (threadId: string) => Promise<Result<ImageDrop | undefined, Transient>>;
}

/**
 * Decodes whatever the key held.
 *
 * Upstash parses stored JSON on the way out, so a current record arrives as an
 * object and a legacy bare slug arrives as the string it was written as.
 */
export function decodeDrop(stored: unknown): ImageDrop | undefined {
  const legacy = z.string().min(1).safeParse(stored);
  if (legacy.success) {
    return {
      batchId: legacy.data,
      source: MediaSource.HackNight,
      label: hackNightLabel(legacy.data),
    };
  }

  const parsed = dropSchema.safeParse(stored);
  if (!parsed.success) return undefined;
  const { batchId, source, label, event } = parsed.data;
  // Rebuilt field by field rather than spread: under `exactOptionalPropertyTypes`
  // an absent `event` and an `event: undefined` are different types.
  return event === undefined ? { batchId, source, label } : { batchId, source, label, event };
}

export function createImageDropStore(redis: DropRedis): ImageDropStore {
  return {
    set: async (threadId, drop) =>
      Result.tryPromise({
        try: async () => {
          await redis.set(dropKey(threadId), drop, { ex: DROP_TTL_SECONDS });
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "store image drop",
            detail: messageOf(cause),
          }),
      }),

    get: async (threadId) =>
      Result.tryPromise({
        try: async () => {
          const stored = await redis.get<unknown>(dropKey(threadId));
          if (stored !== null && stored !== undefined) return decodeDrop(stored);
          return decodeDrop((await redis.get<unknown>(legacyKey(threadId))) ?? undefined);
        },
        catch: (cause) =>
          new Transient({
            operation: "read image drop",
            detail: messageOf(cause),
          }),
      }),
  };
}

/**
 * The stored drop, or `fallback` when there is none.
 *
 * Falls back rather than failing: a missing key means the archive is read and
 * written under the most likely batch, which beats abandoning the upload — but
 * only where a fallback is meaningful at all, which is why the caller supplies
 * it instead of this deriving one.
 */
export async function resolveDrop(
  store: ImageDropStore,
  threadId: string,
  fallback: ImageDrop,
): Promise<ImageDrop> {
  const lookup = await store.get(threadId);
  if (Result.isError(lookup)) return fallback;
  return lookup.value ?? fallback;
}
