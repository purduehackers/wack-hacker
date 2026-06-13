import { describe, it, expect, vi } from "vitest";

import { defineEvent } from "@/bot/events/define";
import { messagePacket, reactionPacket, deletePacket, handlerCtx } from "@/lib/test/fixtures";

import { EventRouter } from "./router";

describe("EventRouter - message routing", () => {
  it("routes mentions to mention handlers", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(
      messagePacket("<@bot-123> hello", { mentions: ["bot-123"] }),
      handlerCtx(),
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes non-mentions to message handlers", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("message", handler);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("runs both mention and message handlers for mentions", async () => {
    const router = new EventRouter();
    const mention = vi.fn();
    const message = vi.fn();
    router.on("mention", mention).on("message", message);
    await router.dispatch(
      messagePacket("<@bot-123> hello", { mentions: ["bot-123"] }),
      handlerCtx(),
    );
    expect(mention).toHaveBeenCalledOnce();
    expect(message).toHaveBeenCalledOnce();
  });

  it("does not run mention handlers for non-mentions", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(handler).not.toHaveBeenCalled();
  });

  it("routes message delete events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("messageDelete", handler);
    await router.dispatch(deletePacket(), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("EventRouter - isBotMention context", () => {
  it("passes isBotMention=true to message handlers for leading mentions", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("message", handler);
    await router.dispatch(
      messagePacket("<@bot-123> hello", { mentions: ["bot-123"] }),
      handlerCtx(),
    );
    expect(handler.mock.calls[0]![1].isBotMention).toBe(true);
  });

  it("passes isBotMention=false to message handlers otherwise", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("message", handler);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(handler.mock.calls[0]![1].isBotMention).toBe(false);
  });

  it("passes isBotMention=false for thread replies routed as mentions", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(
      messagePacket("following up", {
        thread: { parentId: "ch-parent", parentName: "parent" },
        reference: { messageId: "msg-0", authorId: "bot-123" },
      }),
      handlerCtx(),
    );
    expect(handler.mock.calls[0]![1].isBotMention).toBe(false);
  });
});

describe("EventRouter - mention edge cases", () => {
  it("does not route mid-sentence mentions of the bot", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(
      messagePacket("hey <@bot-123> fyi", { mentions: ["bot-123"] }),
      handlerCtx(),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not route leading `<@id>` when the bot is not in the native mentions array", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(messagePacket("<@bot-123> hi", { mentions: [] }), handlerCtx());
    expect(handler).not.toHaveBeenCalled();
  });

  it("routes thread replies to the bot as mentions", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(
      messagePacket("following up", {
        thread: { parentId: "ch-parent", parentName: "parent" },
        reference: { messageId: "msg-0", authorId: "bot-123" },
      }),
      handlerCtx(),
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not route replies to the bot outside a thread", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(
      messagePacket("following up", {
        reference: { messageId: "msg-0", authorId: "bot-123" },
      }),
      handlerCtx(),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not route thread replies to non-bot authors", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("mention", handler);
    await router.dispatch(
      messagePacket("following up", {
        thread: { parentId: "ch-parent", parentName: "parent" },
        reference: { messageId: "msg-0", authorId: "someone-else" },
      }),
      handlerCtx(),
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("EventRouter - other events", () => {
  it("routes reaction events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("reactionAdd", handler);
    await router.dispatch(reactionPacket("👋"), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes reaction remove events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.on("reactionRemove", handler);
    await router.dispatch(reactionPacket("👋", "GATEWAY_MESSAGE_REACTION_REMOVE"), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("runs multiple handlers for the same event", async () => {
    const router = new EventRouter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    router.on("message", h1).on("message", h2);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("does nothing when no handlers registered", async () => {
    const router = new EventRouter();
    await expect(router.dispatch(messagePacket("hello"), handlerCtx())).resolves.toBeUndefined();
  });

  it("registers defineEvent handlers via register()", async () => {
    const router = new EventRouter();
    const handle = vi.fn();
    router.register(defineEvent({ type: "reactionAdd", handle }));
    await router.dispatch(reactionPacket("🎉"), handlerCtx());
    expect(handle).toHaveBeenCalledOnce();
  });
});
