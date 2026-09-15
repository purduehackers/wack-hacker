import { expect, test } from "bun:test";

import { RecoveryRequired, Transient } from "@repo/shared/errors";

import { createSocialDelivery } from "./deliver.ts";
import { createYouTubeSource } from "./sources/feed.ts";

const post = {
  id: "video-1",
  url: "https://www.youtube.com/watch?v=video-1",
  title: "A demo",
  text: "@everyone watch this",
  publishedAt: "2026-09-15T00:00:00Z",
  imageUrl: "https://i.ytimg.com/vi/video-1/hqdefault.jpg",
};
const source = createYouTubeSource();
const renew = async () => {};

test("Discord sends a consistent embed, disables pings, and reuses the enforced nonce", async () => {
  const bodies: unknown[] = [];
  const client: Parameters<typeof createSocialDelivery>[0] = {
    user: { id: "bot" },
    rest: {
      get: async () => [],
      post: async (_route, options) => {
        bodies.push(options?.body);
        return { id: "message" };
      },
    },
  };
  const delivery = createSocialDelivery(client, "channel", renew);
  await delivery.send(source, post);
  await delivery.send(source, post);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({
    allowed_mentions: { parse: [] },
    enforce_nonce: true,
    nonce: expect.stringMatching(/^[a-f0-9]{25}$/u),
    embeds: [{ url: post.url, author: { name: "Purdue Hackers · YouTube" } }],
  });
});

test("a worker that lost its lease cannot post to Discord", async () => {
  let sends = 0;
  const delivery = createSocialDelivery(
    {
      user: { id: "bot" },
      rest: {
        get: async () => [],
        post: async () => {
          sends++;
          return { id: "message" };
        },
      },
    },
    "channel",
    async () => {
      throw new Transient({ operation: "lease", detail: "expired" });
    },
  );
  const result = await delivery.send(source, post).catch((cause: unknown) => cause);
  expect(result).toBeInstanceOf(Transient);
  expect(sends).toBe(0);
});

test("reconciliation follows history and ignores someone else's matching link", async () => {
  const queries: string[] = [];
  const message = (id: string, author: string) => ({
    id,
    author: { id: author },
    timestamp: "2026-09-15T01:00:00Z",
    embeds: [{ url: post.url }],
  });
  const client: Parameters<typeof createSocialDelivery>[0] = {
    user: { id: "bot" },
    rest: {
      post: async () => ({ id: "unused" }),
      get: async (_route, options) => {
        queries.push(options?.query?.toString() ?? "");
        return queries.length === 1
          ? [message("newest", "another-user")]
          : [message("ours", "bot")];
      },
    },
  };
  expect(
    await createSocialDelivery(client, "channel", renew).find(post, Date.parse(post.publishedAt)),
  ).toBe(true);
  expect(queries).toEqual(["limit=100", "limit=100&before=newest"]);
});

test("a truncated reconciliation never treats an unseen message as absent", async () => {
  const delivery = createSocialDelivery(
    {
      user: { id: "bot" },
      rest: {
        post: async () => ({ id: "unused" }),
        get: async () => [
          {
            id: "newest",
            author: { id: "someone" },
            timestamp: "2026-09-15T01:00:00Z",
            embeds: [],
          },
        ],
      },
    },
    "channel",
    renew,
  );
  const result = await delivery
    .find(post, Date.parse(post.publishedAt))
    .catch((cause: unknown) => cause);
  expect(result).toBeInstanceOf(RecoveryRequired);
});

test("missing history permission blocks reconciliation and sending", async () => {
  let requests = 0;
  const deny = async () => {
    throw new RecoveryRequired({
      operation: "test access",
      detail: "history permission missing",
      remediation: "restore permission",
    });
  };
  const delivery = createSocialDelivery(
    {
      user: { id: "bot" },
      rest: {
        get: async () => {
          requests++;
          return [];
        },
        post: async () => {
          requests++;
          return { id: "unused" };
        },
      },
    },
    "channel",
    deny,
  );
  expect(
    await delivery.find(post, Date.parse(post.publishedAt)).catch((cause: unknown) => cause),
  ).toBeInstanceOf(RecoveryRequired);
  expect(await delivery.send(source, post).catch((cause: unknown) => cause)).toBeInstanceOf(
    RecoveryRequired,
  );
  expect(requests).toBe(0);
});
