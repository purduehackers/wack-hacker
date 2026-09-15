import { InvalidInput, RecoveryRequired, retryAfterMs } from "@repo/shared/errors";

import type { SocialLease, SocialState } from "./store.ts";
import type { SocialPost, SocialSource } from "./types.ts";

const OVERLAP_MS = 7 * 24 * 60 * 60 * 1_000;

function sortedPosts(entries: readonly SocialPost[]): SocialPost[] {
  const unique = new Map(entries.map((post) => [post.id, post]));
  return [...unique.values()].sort(
    (left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt),
  );
}

export async function requireSocialState(
  source: SocialSource,
  lease: SocialLease,
): Promise<SocialState> {
  const state = await lease.load();
  if (state === undefined) {
    throw new RecoveryRequired({
      operation: `${source.id} polling`,
      detail: "source has no baseline",
      remediation: "restore the initialized source state from backup",
    });
  }
  return state;
}

/** Queue admission and the polling checkpoint commit in one fenced Redis write. */
export async function pollSocialSource(
  source: SocialSource,
  lease: SocialLease,
  now = Date.now(),
): Promise<void> {
  const state = await requireSocialState(source, lease);
  if (state.pollRetryAt > now) return;
  const since = new Date(Math.max(state.baselineAt, state.checkedAt - OVERLAP_MS));
  let entries: SocialPost[];
  try {
    entries = sortedPosts(await source.read(since));
  } catch (cause) {
    state.pollRetryAt = now + (retryAfterMs(cause) ?? 5 * 60_000);
    await lease.save(state);
    throw cause;
  }
  const known = new Set(state.knownIds);
  const oldest = entries[0];
  if (
    source.history === "window" &&
    oldest !== undefined &&
    Date.parse(oldest.publishedAt) > state.checkedAt &&
    !entries.some((entry) => known.has(entry.id))
  ) {
    throw new RecoveryRequired({
      operation: `${source.id} polling`,
      detail: "the feed no longer overlaps the last successful check",
      remediation: "recover missed posts and repair the checkpoint before resuming",
    });
  }
  for (const post of entries) {
    const published = Date.parse(post.publishedAt);
    if (published > now + 5 * 60_000) {
      throw new InvalidInput({
        subject: `${source.id} post`,
        issues: ["publication time is in the future"],
      });
    }
    if (known.has(post.id)) continue;
    known.add(post.id);
    // Old content reappearing in a feed cannot become a new announcement.
    if (published < state.baselineAt) continue;
    state.pending.push({ post, attempts: 0, retryAt: now });
  }
  state.knownIds = [...known];
  state.checkedAt = now;
  state.pollRetryAt = 0;
  await lease.save(state);
}
