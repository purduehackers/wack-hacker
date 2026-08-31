/**
 * The event picker behind the `event` option's autocomplete.
 *
 * Discord throws away an autocomplete response that takes longer than three
 * seconds and sends a fresh interaction on *every keystroke*, so the CMS cannot
 * be on that path. Three layers keep it off:
 *
 * 1. an in-process memo, which is what a burst of keystrokes actually hits;
 * 2. Redis, so a restart or a second instance starts warm rather than cold;
 * 3. the CMS, under a two-second budget and a cooldown after a failure, so a
 *    slow upstream is asked once rather than once per character.
 *
 * Staleness is the deliberate trade. An event created a minute ago may not be
 * suggested yet — which is exactly why the option is autocomplete rather than a
 * fixed choice list: a slug typed by hand is still accepted, and the command
 * resolves it against the CMS itself rather than against this cache.
 */

import { messageOf, tagOf } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { z } from "zod";

import { TIME_ZONE } from "../utils/dates.ts";
import type { CmsClient, CmsEventSummary } from "./cms.ts";

const CACHE_KEY = "cms:events:v1";
const CACHE_TTL_SECONDS = 10 * 60;
/** How long a loaded list serves keystrokes without touching Redis. */
const MEMO_MS = 60_000;
/** After a failed refresh, how long before the CMS is asked again. */
const COOLDOWN_MS = 30_000;
/** Well inside Discord's three-second autocomplete deadline. */
const FETCH_BUDGET_MS = 2_000;
/**
 * How long a keystroke waits on a refresh before answering without it.
 *
 * Shorter than the fetch budget on purpose: a cold cache answers this keystroke
 * with whatever it has and lets the refresh land for the next one, which is a
 * beat later. Waiting for the fetch instead would put a slow CMS on the wrong
 * side of Discord's deadline, and a response Discord has stopped listening for
 * is worse than an empty one.
 */
const ANSWER_BUDGET_MS = 1_200;
/** Discord's cap on autocomplete choices. */
const SUGGESTION_LIMIT = 25;
/** Discord's cap on a choice's display name. */
const CHOICE_NAME_LIMIT = 100;

const summarySchema = z.strictObject({
  id: z.union([z.string(), z.number()]),
  slug: z.string().min(1),
  name: z.string(),
  start: z.string().optional(),
  published: z.boolean().optional(),
});
const cacheSchema = z.array(summarySchema);

/**
 * Rebuilt field by field rather than spread: under `exactOptionalPropertyTypes`
 * an absent `start` and a `start: undefined` are different types.
 */
function summaryOf(row: z.output<typeof summarySchema>): CmsEventSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ...(row.start !== undefined && { start: row.start }),
    ...(row.published !== undefined && { published: row.published }),
  };
}

const startFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

function startedOn(event: CmsEventSummary): string | undefined {
  if (event.start === undefined) return undefined;
  const at = new Date(event.start);
  return Number.isNaN(at.getTime()) ? undefined : startFormatter.format(at);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * What one suggestion reads as.
 *
 * The date disambiguates the recurring names — three years of `Hack Night` are
 * otherwise indistinguishable in the list — and the draft marker is there
 * because filing photos to an unpublished event is normal, but doing it by
 * accident is not.
 */
export function describeEvent(event: CmsEventSummary): string {
  const on = startedOn(event);
  // Only an event the CMS actually told us is unpublished is marked; one whose
  // flag never reached us is left alone rather than libelled as a draft.
  const { published } = event;
  const draft = published !== undefined && !published ? " (draft)" : "";
  return truncate(`${event.name}${on === undefined ? "" : ` — ${on}`}${draft}`, CHOICE_NAME_LIMIT);
}

/** Most recent first; an event with no start date sorts last. */
function byStartDescending(left: CmsEventSummary, right: CmsEventSummary): number {
  const leftStart = left.start ?? "";
  const rightStart = right.start ?? "";
  if (leftStart === rightStart) return left.name.localeCompare(right.name);
  return leftStart < rightStart ? 1 : -1;
}

/**
 * How well an event answers what has been typed, lower being better, or
 * `undefined` for one that does not answer it at all.
 *
 * A word-boundary match ranks above a mid-word one so typing `galaxy` puts
 * "Sound Galaxy Workshop" above "Metagalaxy", which is the order someone typing
 * a word rather than a fragment expects.
 */
function score(event: CmsEventSummary, query: string): number | undefined {
  const name = event.name.toLowerCase();
  const slug = event.slug.toLowerCase();
  if (name.startsWith(query) || slug.startsWith(query)) return 0;
  if (name.split(/[\s-]+/).some((word) => word.startsWith(query))) return 1;
  if (name.includes(query) || slug.includes(query)) return 2;
  return undefined;
}

/**
 * The events worth suggesting for what has been typed so far.
 *
 * An empty query is the common case — the option is focused before anything is
 * typed — and answers with the most recent events, which is what an organizer
 * filing tonight's photos is almost always after.
 */
export function rankEvents(
  events: readonly CmsEventSummary[],
  query: string,
  limit: number = SUGGESTION_LIMIT,
): readonly CmsEventSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...events].sort(byStartDescending).slice(0, limit);

  return events
    .flatMap((candidate) => {
      const rank = score(candidate, needle);
      return rank === undefined ? [] : [{ event: candidate, rank }];
    })
    .sort((left, right) =>
      left.rank === right.rank
        ? byStartDescending(left.event, right.event)
        : left.rank - right.rank,
    )
    .slice(0, limit)
    .map((scored) => scored.event);
}

export interface EventDirectory {
  /** Never rejects: a picker that throws would just show Discord's own error. */
  readonly suggest: (query: string) => Promise<readonly CmsEventSummary[]>;
}

export function createEventDirectory(deps: {
  readonly cms: Pick<CmsClient, "listEvents">;
  readonly redis: Pick<RedisClient, "get" | "set">;
  readonly reporter: Reporter;
}): EventDirectory {
  let cached: readonly CmsEventSummary[] | undefined;
  let freshUntil = 0;
  let cooldownUntil = 0;
  let inFlight: Promise<readonly CmsEventSummary[] | undefined> | undefined;

  const report = (op: "cms.events.refresh" | "cms.events.cache", error: unknown): void => {
    deps.reporter.emit({
      op,
      status: "error",
      errorTag: tagOf(error),
      errorMessage: messageOf(error),
    });
  };

  const adopt = (events: readonly CmsEventSummary[]): readonly CmsEventSummary[] => {
    cached = events;
    freshUntil = Date.now() + MEMO_MS;
    return events;
  };

  const fromCache = async (): Promise<readonly CmsEventSummary[] | undefined> => {
    const stored = await Result.tryPromise({
      try: () => deps.redis.get<unknown>(CACHE_KEY),
      catch: (cause) => cause,
    });
    if (Result.isError(stored)) {
      report("cms.events.cache", stored.error);
      return undefined;
    }

    const parsed = cacheSchema.safeParse(stored.value);
    // A shape this version does not understand is treated as a miss, so a
    // rollout that changes the cached fields refills rather than throws.
    return parsed.success ? parsed.data.map(summaryOf) : undefined;
  };

  const toCache = async (events: readonly CmsEventSummary[]): Promise<void> => {
    const written = await Result.tryPromise({
      try: () => deps.redis.set(CACHE_KEY, events, { ex: CACHE_TTL_SECONDS }),
      catch: (cause) => cause,
    });
    // Reported rather than swallowed: without the shared cache every instance
    // falls back to the CMS on its own memo expiry.
    if (Result.isError(written)) report("cms.events.cache", written.error);
  };

  const refresh = async (): Promise<readonly CmsEventSummary[] | undefined> => {
    const stored = await fromCache();
    if (stored !== undefined) return adopt(stored);

    const listed = await deps.cms.listEvents(AbortSignal.timeout(FETCH_BUDGET_MS));
    if (Result.isError(listed)) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      report("cms.events.refresh", listed.error);
      return undefined;
    }

    await toCache(listed.value);
    return adopt(listed.value);
  };

  const load = async (): Promise<readonly CmsEventSummary[]> => {
    const now = Date.now();
    if (cached !== undefined && now < freshUntil) return cached;
    // Serve the last good list through a cooldown. Stale suggestions beat none,
    // and the slug is validated against the CMS when the command actually runs.
    if (now < cooldownUntil) return cached ?? [];

    // One refresh for a burst of keystrokes, not one per character.
    inFlight ??= refresh().finally(() => {
      inFlight = undefined;
    });

    const answered = await Promise.race([
      inFlight,
      new Promise<undefined>((resolve) => {
        setTimeout(resolve, ANSWER_BUDGET_MS);
      }),
    ]);
    return answered ?? cached ?? [];
  };

  return { suggest: async (query) => rankEvents(await load(), query) };
}
