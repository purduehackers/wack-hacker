import { describe, it, expect, vi } from "vitest";

import { PacketCodec } from "@/lib/protocol/packets";
import {
  messagePacket,
  reactionPacket,
  deletePacket,
  voiceStatePacket,
  threadCreatePacket,
  messageUpdatePacket,
  handlerCtx,
} from "@/lib/test/fixtures";

import { EventRouter } from "./router";

describe("EventRouter - message routing", () => {
  it("routes mentions to mention handlers", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMention(handler);
    await router.dispatch(
      messagePacket("<@bot-123> hello", { mentions: ["bot-123"] }),
      handlerCtx(),
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes non-mentions to message handlers", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMessage(handler);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("runs both mention and message handlers for mentions", async () => {
    const router = new EventRouter();
    const mention = vi.fn();
    const message = vi.fn();
    router.onMention(mention).onMessage(message);
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
    router.onMention(handler);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(handler).not.toHaveBeenCalled();
  });

  it("routes message update events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMessageUpdate(handler);
    await router.dispatch(messageUpdatePacket(), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes message delete events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMessageDelete(handler);
    await router.dispatch(deletePacket(), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("EventRouter - mention edge cases", () => {
  it("does not route mid-sentence mentions of the bot", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMention(handler);
    await router.dispatch(
      messagePacket("hey <@bot-123> fyi", { mentions: ["bot-123"] }),
      handlerCtx(),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not route leading `<@id>` when the bot is not in the native mentions array", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMention(handler);
    await router.dispatch(messagePacket("<@bot-123> hi", { mentions: [] }), handlerCtx());
    expect(handler).not.toHaveBeenCalled();
  });

  it("routes thread replies to the bot as mentions", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMention(handler);
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
    router.onMention(handler);
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
    router.onMention(handler);
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
    router.onReactionAdd(handler);
    await router.dispatch(reactionPacket("👋"), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes reaction remove events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onReactionRemove(handler);
    await router.dispatch(reactionPacket("👋", "GATEWAY_MESSAGE_REACTION_REMOVE"), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes voice state updates", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onVoiceStateUpdate(handler);
    await router.dispatch(voiceStatePacket(), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("routes thread create events", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onThreadCreate(handler);
    await router.dispatch(threadCreatePacket(), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("runs multiple handlers for the same event", async () => {
    const router = new EventRouter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    router.onMessage(h1).onMessage(h2);
    await router.dispatch(messagePacket("hello"), handlerCtx());
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("does nothing when no handlers registered", async () => {
    const router = new EventRouter();
    await expect(router.dispatch(messagePacket("hello"), handlerCtx())).resolves.toBeUndefined();
  });

  it("routes from raw JSON via route()", async () => {
    const router = new EventRouter();
    const handler = vi.fn();
    router.onMessage(handler);
    await router.route(PacketCodec.encode(messagePacket("hello")), handlerCtx());
    expect(handler).toHaveBeenCalledOnce();
  });
});
