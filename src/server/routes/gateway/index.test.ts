import type { Client } from "discord.js";

import { Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { Packet } from "@/lib/protocol/types";

vi.hoisted(() => {
  // `env` is read at module load; inject the secret before the route module
  // (and everything it imports) evaluates. Drop any ambient OIDC token so the
  // authorized request deterministically stops at the OIDC-availability gate
  // instead of trying to log into Discord.
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.VERCEL_OIDC_TOKEN;
});

const { default: route, bindMessageCreateHandler, bindReactionHandlers } = await import("./index");

describe("GET /gateway auth", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await route.request("/gateway");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await route.request("/gateway", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("proceeds past auth with the cron secret", async () => {
    const res = await route.request("/gateway", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    // Auth passed; the next gate (OIDC availability) fails in the test env.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "oidc unavailable" });
  });
});

// Captures listeners off a stub client so each can be invoked directly with
// plain-object fakes. The fakes deliberately lack a `fetch` method: a
// reintroduced `reaction.message.fetch()` throws and the publish assertion
// fails, pinning the read-off-the-partial contract.
function stubClient(): {
  client: Client;
  listeners: Map<string, (...args: unknown[]) => Promise<void>>;
} {
  const listeners = new Map<string, (...args: unknown[]) => Promise<void>>();
  const stub = {
    on(event: string, fn: (...args: unknown[]) => Promise<void>) {
      listeners.set(event, fn);
      return stub;
    },
  };
  return { client: stub as unknown as Client, listeners };
}

function fakeReaction(guildId: string | null) {
  return {
    message: { id: "msg-1", channelId: "ch-1", guildId },
    emoji: { id: null, name: "✨" },
  };
}

const alice = { bot: false, id: "user-1", username: "alice" };

describe("gateway reaction handlers", () => {
  function setup() {
    const { client, listeners } = stubClient();
    const publish = vi.fn(async (_packet: Packet) => {});
    bindReactionHandlers(client, publish);
    return { listeners, publish };
  }

  it("publishes a reaction-add packet sourced from the partial without fetching", async () => {
    const { listeners, publish } = setup();

    await listeners.get(Events.MessageReactionAdd)!(fakeReaction("guild-1"), alice);

    expect(publish).toHaveBeenCalledWith({
      type: "GATEWAY_MESSAGE_REACTION_ADD",
      timestamp: expect.any(Date),
      data: {
        messageId: "msg-1",
        channelId: "ch-1",
        guildId: "guild-1",
        emoji: { id: null, name: "✨" },
        creator: { id: "user-1", username: "alice" },
      },
    });
  });

  it("publishes a reaction-remove packet sourced from the partial", async () => {
    const { listeners, publish } = setup();

    await listeners.get(Events.MessageReactionRemove)!(fakeReaction("guild-1"), alice);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "GATEWAY_MESSAGE_REACTION_REMOVE" }),
    );
  });

  it("falls back to an empty guildId when the partial has none", async () => {
    const { listeners, publish } = setup();

    await listeners.get(Events.MessageReactionAdd)!(fakeReaction(null), alice);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ guildId: "" }) }),
    );
  });

  it("ignores bot reactions", async () => {
    const { listeners, publish } = setup();

    await listeners.get(Events.MessageReactionAdd)!(fakeReaction("guild-1"), {
      ...alice,
      bot: true,
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it("swallows publish rejections so the listener never produces an unhandled rejection", async () => {
    const { listeners, publish } = setup();
    publish.mockRejectedValueOnce(new Error("queue down"));

    await expect(
      listeners.get(Events.MessageReactionAdd)!(fakeReaction("guild-1"), alice),
    ).resolves.toBeUndefined();
  });
});

describe("gateway message-create handler", () => {
  it("ignores bot-authored messages", async () => {
    const { client, listeners } = stubClient();
    const publish = vi.fn(async (_packet: Packet) => {});
    bindMessageCreateHandler(client, publish);

    await listeners.get(Events.MessageCreate)!({ author: { bot: true }, channel: {} });

    expect(publish).not.toHaveBeenCalled();
  });
});
