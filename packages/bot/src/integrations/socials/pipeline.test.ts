import { expect, test } from "bun:test";

import { RateLimited, RecoveryRequired, Transient } from "@repo/shared/errors";

import { deliverSocialPosts } from "./deliver.ts";
import type { SocialDelivery } from "./deliver.ts";
import { baselineSocialSource, pollSocialSource } from "./poll.ts";
import type { SocialLease, SocialState } from "./store.ts";
import type { SocialPost, SocialSource } from "./types.ts";

const BASELINE = Date.parse("2026-09-15T00:00:00Z");
const fixturePost = (id: string, publishedAt: number): SocialPost => ({
  id,
  publishedAt: new Date(publishedAt).toISOString(),
  url: `https://blog.purduehackers.com/posts/${id}/`,
  title: id,
  text: "Caption",
});
function fixtureSource(
  read: SocialSource["read"],
  history: SocialSource["history"] = "paginated",
): SocialSource {
  return {
    id: "blog",
    account: "blog.purduehackers.com",
    name: "Blog",
    profileUrl: "https://blog.purduehackers.com",
    history,
    read,
  };
}
function memoryLease(initial?: SocialState) {
  let saved = structuredClone(initial);
  let writes = 0;
  let failAt = -1;
  const lease: SocialLease = {
    load: async () => structuredClone(saved),
    save: async (state) => {
      writes++;
      if (writes === failAt)
        throw new Transient({ operation: "Redis save", detail: "simulated connection loss" });
      saved = structuredClone(state);
    },
    renew: async () => {},
  };
  return {
    lease,
    state: () => structuredClone(saved),
    failNext: (offset = 1) => {
      failAt = writes + offset;
    },
  };
}
const oldPost = fixturePost("old", BASELINE - 60_000);
const newPost = fixturePost("new", BASELINE + 60_000);

test("baseline is silent and cannot reset an existing checkpoint", async () => {
  const memory = memoryLease();
  const source = fixtureSource(async () => [oldPost]);
  await baselineSocialSource(source, memory.lease, BASELINE);
  await baselineSocialSource(source, memory.lease, BASELINE + 60_000);
  expect(memory.state()).toMatchObject({ baselineAt: BASELINE, knownIds: ["old"], pending: [] });
});

test("deduplicates reordered entries and ignores reappearing historical content", async () => {
  const memory = memoryLease();
  await baselineSocialSource(
    fixtureSource(async () => [oldPost]),
    memory.lease,
    BASELINE,
  );
  const source = fixtureSource(async () => [
    newPost,
    oldPost,
    newPost,
    fixturePost("ancient", BASELINE - 120_000),
  ]);
  await pollSocialSource(source, memory.lease, BASELINE + 120_000);
  await pollSocialSource(source, memory.lease, BASELINE + 180_000);
  expect(memory.state()?.pending.map((entry) => entry.post.id)).toEqual(["new"]);
});

test("a failed queue write does not advance the checkpoint or lose the post", async () => {
  const memory = memoryLease();
  await baselineSocialSource(
    fixtureSource(async () => [oldPost]),
    memory.lease,
    BASELINE,
  );
  const source = fixtureSource(async () => [newPost]);
  memory.failNext();
  expect(
    await pollSocialSource(source, memory.lease, BASELINE + 120_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(Transient);
  expect(memory.state()?.checkedAt).toBe(BASELINE);
  await pollSocialSource(source, memory.lease, BASELINE + 180_000);
  expect(memory.state()?.pending).toHaveLength(1);
});

test("missing baseline and a feed-window gap fail closed", async () => {
  const memory = memoryLease();
  const source = fixtureSource(async () => [newPost], "window");
  expect(
    await pollSocialSource(source, memory.lease, BASELINE).catch((cause: unknown) => cause),
  ).toBeInstanceOf(RecoveryRequired);
  await baselineSocialSource(
    fixtureSource(async () => [oldPost]),
    memory.lease,
    BASELINE,
  );
  expect(
    await pollSocialSource(source, memory.lease, BASELINE + 120_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(RecoveryRequired);
  expect(memory.state()?.checkedAt).toBe(BASELINE);
});

test("rate limits preserve checkpoint and prevent early polling", async () => {
  const memory = memoryLease();
  await baselineSocialSource(
    fixtureSource(async () => [oldPost]),
    memory.lease,
    BASELINE,
  );
  let calls = 0;
  const source = fixtureSource(async () => {
    calls++;
    throw new RateLimited({ service: "blog", retryAfterMs: 900_000 });
  });
  expect(
    await pollSocialSource(source, memory.lease, BASELINE + 60_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(RateLimited);
  await pollSocialSource(source, memory.lease, BASELINE + 120_000);
  expect(calls).toBe(1);
  expect(memory.state()?.checkedAt).toBe(BASELINE);
});

async function queuedPost() {
  const memory = memoryLease();
  await baselineSocialSource(
    fixtureSource(async () => [oldPost]),
    memory.lease,
    BASELINE,
  );
  const source = fixtureSource(async () => [newPost]);
  await pollSocialSource(source, memory.lease, BASELINE + 120_000);
  return { ...memory, source };
}

test("a send failure stops the batch without attempting later posts", async () => {
  const memory = await queuedPost();
  await pollSocialSource(
    fixtureSource(async () => [newPost, fixturePost("second", BASELINE + 70_000)]),
    memory.lease,
    BASELINE + 120_000,
  );
  const attempted: string[] = [];
  const delivery: SocialDelivery = {
    send: async (_source, post) => {
      attempted.push(post.id);
      throw new RateLimited({ service: "discord", retryAfterMs: 900_000 });
    },
    find: async () => false,
  };
  expect(
    await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 120_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(RateLimited);
  expect(attempted).toEqual(["new"]);
  expect(memory.state()?.pending.map((item) => item.attempts)).toEqual([1, 0]);
});

test("a failed queue removal reconciles the message before retrying", async () => {
  const memory = await queuedPost();
  let sends = 0;
  let scans = 0;
  const delivery: SocialDelivery = {
    send: async () => {
      sends++;
    },
    find: async () => {
      scans++;
      return true;
    },
  };
  memory.failNext(2); // Intent succeeds, Discord accepts, queue removal fails.
  expect(
    await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 120_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(Transient);
  const restarted = memoryLease(memory.state());
  await deliverSocialPosts(memory.source, restarted.lease, delivery, BASELINE + 240_000);
  expect(sends).toBe(1);
  expect(scans).toBe(1);
  expect(restarted.state()?.pending).toHaveLength(0);
  expect(restarted.state()?.knownIds).toContain("new");
});

test("an uncertain POST is reconciled; backoff prevents premature retries", async () => {
  const memory = await queuedPost();
  let sends = 0;
  const delivery: SocialDelivery = {
    send: async () => {
      sends++;
      throw new Transient({
        operation: "Discord send",
        detail: "lost response after acceptance",
      });
    },
    find: async () => true,
  };
  expect(
    await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 120_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(Transient);
  await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 130_000);
  expect(memory.state()?.pending).toHaveLength(1);
  await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 240_000);
  expect(sends).toBe(1);
  expect(memory.state()?.pending).toHaveLength(0);
});

test("failed reconciliation never resends and preserves pending work", async () => {
  const memory = await queuedPost();
  let sends = 0;
  const delivery: SocialDelivery = {
    send: async () => {
      sends++;
      throw new Transient({ operation: "Discord send", detail: "timeout" });
    },
    find: async () => {
      throw new Transient({ operation: "Discord history", detail: "timeout" });
    },
  };
  expect(
    await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 120_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(Transient);
  expect(
    await deliverSocialPosts(memory.source, memory.lease, delivery, BASELINE + 240_000).catch(
      (cause: unknown) => cause,
    ),
  ).toBeInstanceOf(Transient);
  expect(sends).toBe(1);
  expect(memory.state()?.pending).toHaveLength(1);
});
