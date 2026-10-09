import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";

import { MessageFlags, RESTJSONErrorCodes, Routes } from "discord-api-types/v10";
import { DiscordAPIError } from "discord.js";

import { createSocialDelivery, deliverSocialPosts } from "./deliver.ts";
import type { SocialLease, SocialState } from "./store.ts";
import type { SocialPost, SocialSource } from "./types.ts";

const NOW = Date.parse("2026-10-09T04:31:00Z");
const CHANNEL = "1416915165609463888";
const BOT = "1115068381649961060";
const post: SocialPost = {
  id: "reel-id",
  url: "https://www.instagram.com/reel/example/",
  title: "New Instagram video",
  text: "Come to Hack Night!",
  publishedAt: new Date(NOW - 60_000).toISOString(),
};
const source: SocialSource = {
  id: "instagram",
  account: "account-id",
  name: "Instagram",
  profileUrl: "https://www.instagram.com/purduehackers/",
  history: "paginated",
  read: async () => [post],
};

type Failure = "send-response" | "publish-rejected" | "publish-response" | "completion-save";

function harness(failure?: Failure) {
  let state: SocialState = {
    version: 1,
    account: source.account,
    baselineAt: NOW - 60_000,
    checkedAt: NOW,
    pollRetryAt: 0,
    knownIds: [post.id],
    pending: [{ post, attempts: 0, retryAt: NOW }],
  };
  const messages: {
    id: string;
    flags: number;
    author: { id: string };
    timestamp: string;
    embeds: { url: string }[];
  }[] = [];
  const operations: string[] = [];
  let failed = false;
  const failOnce = (at: Failure) => {
    if (failure === at && !failed) {
      failed = true;
      throw new Error(`simulated ${at}`);
    }
  };
  const lease: SocialLease = {
    load: async () => structuredClone(state),
    save: async (next) => {
      if (next.pending.length === 0) failOnce("completion-save");
      state = structuredClone(next);
    },
    renew: async () => {},
  };
  const delivery = createSocialDelivery(
    {
      user: { id: BOT },
      rest: {
        get: async () => {
          operations.push("history");
          return structuredClone(messages);
        },
        post: async (route) => {
          if (route === Routes.channelMessages(CHANNEL)) {
            operations.push("send");
            const message = {
              id: `message-${messages.length}`,
              flags: 0,
              author: { id: BOT },
              timestamp: new Date(NOW).toISOString(),
              embeds: [{ url: post.url }],
            };
            messages.unshift(message);
            failOnce("send-response");
            return structuredClone(message);
          }
          const message = messages.find(
            (entry) => route === Routes.channelMessageCrosspost(CHANNEL, entry.id),
          );
          if (message === undefined) throw new Error(`unexpected route: ${route}`);
          operations.push("publish");
          failOnce("publish-rejected");
          message.flags |= MessageFlags.Crossposted;
          failOnce("publish-response");
          return structuredClone(message);
        },
      },
    },
    CHANNEL,
    async () => {
      operations.push("guard");
    },
  );
  return {
    run: (now = NOW) => deliverSocialPosts(source, lease, delivery, now),
    state: () => state,
    messages,
    operations,
  };
}

test("delivery sends and publishes before removing the pending post", async () => {
  const check = harness();
  await check.run();
  expect(check.operations).toEqual(["guard", "send", "guard", "publish"]);
  expect(check.messages).toHaveLength(1);
  expect(check.messages[0]?.flags).toBe(MessageFlags.Crossposted);
  expect(check.state().pending).toHaveLength(0);
});

const failures: Failure[] = [
  "send-response",
  "publish-rejected",
  "publish-response",
  "completion-save",
];
test.each(failures)("a lost %s is recovered without another message", async (failure) => {
  const check = harness(failure);
  await rejects(check.run(), { message: `simulated ${failure}` });
  expect(check.state().pending).toHaveLength(1);
  expect(check.state().pending[0]?.attempts).toBe(1);
  const beforeRetry = check.operations.length;
  await check.run(NOW + 59_999);
  expect(check.operations).toHaveLength(beforeRetry);
  await check.run(NOW + 60_000);
  expect(check.messages).toHaveLength(1);
  expect(check.messages[0]?.flags).toBe(MessageFlags.Crossposted);
  expect(check.state().pending).toHaveLength(0);
  expect(check.operations.filter((operation) => operation === "send")).toHaveLength(1);
  expect(check.operations.filter((operation) => operation === "publish")).toHaveLength(
    failure === "publish-rejected" ? 2 : 1,
  );
});

test.each([
  RESTJSONErrorCodes.ThisMessageWasAlreadyCrossposted,
  RESTJSONErrorCodes.MissingPermissions,
])("publication handles Discord error %s without hiding other errors", async (code) => {
  const error = new DiscordAPIError(
    { code, message: "simulated Discord response" },
    code,
    400,
    "POST",
    `https://discord.com/api/v10${Routes.channelMessageCrosspost(CHANNEL, "message-id")}`,
    {},
  );
  const delivery = createSocialDelivery(
    {
      user: { id: BOT },
      rest: {
        get: async () => [],
        post: async () => {
          throw error;
        },
      },
    },
    CHANNEL,
    async () => {},
  );
  const publishing = delivery.publish({ id: "message-id", flags: 0 });
  if (code === RESTJSONErrorCodes.ThisMessageWasAlreadyCrossposted) {
    expect(await publishing).toBeUndefined();
  } else {
    await rejects(publishing, error);
  }
});
