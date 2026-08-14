/**
 * Paging Discord's three archived-thread routes.
 *
 * Only `list_threads` needs this, but it is not a detail of that tool. Each
 * route pages on a different cursor:
 *
 * - public and private archived threads page on the last thread's
 *   `archive_timestamp`
 * - joined-private threads page on the thread snowflake
 *
 * A cursor that fails to strictly advance loops forever against a server that
 * is merely misbehaving. Keeping the walk and its termination proof in one
 * module is what makes that guarantee reviewable.
 */

import { makeURLSearchParams, type REST, type RouteLike } from "@discordjs/rest";
import type {
  RESTGetAPIChannelThreadsArchivedQuery,
  RESTGetAPIChannelUsersThreadsArchivedResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { discordArray, discordObject, malformedDiscordResponse } from "./client.ts";
import { discordSnowflakeSchema, type ThreadResult } from "./constants.ts";

const ARCHIVED_THREAD_PAGE_LIMIT = 100;
const MAX_ARCHIVED_THREAD_PAGES = 100;
const archiveTimestampCursorSchema = z.iso.datetime({ offset: true });

export type ArchiveCursorKind = "archive-timestamp" | "thread-snowflake";

/** Each archived-thread route pages on its own cursor, which must strictly advance. */
function nextArchiveCursor(
  thread: ThreadResult,
  kind: ArchiveCursorKind,
  previous: string | undefined,
  endpoint: string,
): string {
  if (kind === "thread-snowflake") {
    const parsed = discordSnowflakeSchema.safeParse(thread.id);
    if (!parsed.success || (previous !== undefined && BigInt(parsed.data) >= BigInt(previous))) {
      throw malformedDiscordResponse(`${endpoint} pagination cursor`);
    }
    return parsed.data;
  }

  const metadata = discordObject<NonNullable<ThreadResult["thread_metadata"]>>(
    thread.thread_metadata,
    `${endpoint} thread metadata`,
  );
  const parsed = archiveTimestampCursorSchema.safeParse(metadata.archive_timestamp);
  if (
    !parsed.success ||
    (previous !== undefined && Date.parse(parsed.data) >= Date.parse(previous))
  ) {
    throw malformedDiscordResponse(`${endpoint} pagination cursor`);
  }
  return parsed.data;
}

/**
 * Walks one archived-thread route to exhaustion and returns every thread.
 *
 * Termination is the contract: the cursor must strictly advance on every
 * page, and a hard page cap backstops it. A misbehaving server therefore
 * ends in a malformed-response error, not an infinite loop.
 */
export async function archivedThreadPages<
  ResultType extends RESTGetAPIChannelUsersThreadsArchivedResult,
>(
  rest: REST,
  route: RouteLike,
  endpoint: string,
  cursorKind: ArchiveCursorKind,
): Promise<ThreadResult[]> {
  const found: ThreadResult[] = [];
  let before: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_ARCHIVED_THREAD_PAGES; pageNumber += 1) {
    const page = discordObject<ResultType>(
      await rest.get(route, {
        query: makeURLSearchParams<RESTGetAPIChannelThreadsArchivedQuery>({
          limit: ARCHIVED_THREAD_PAGE_LIMIT,
          ...(before === undefined ? {} : { before }),
        }),
      }),
      endpoint,
    );
    const hasMore = z.boolean().safeParse(page.has_more);
    if (!hasMore.success) throw malformedDiscordResponse(endpoint);
    const threads = discordArray<ResultType["threads"]>(page.threads, endpoint).map((candidate) =>
      discordObject<ThreadResult>(candidate, endpoint),
    );
    found.push(...threads);
    if (!hasMore.data) return found;
    const lastThread = threads.at(-1);
    if (lastThread === undefined) throw malformedDiscordResponse(`${endpoint} pagination cursor`);
    before = nextArchiveCursor(lastThread, cursorKind, before, endpoint);
  }
  throw malformedDiscordResponse(`${endpoint} pagination did not terminate`);
}
