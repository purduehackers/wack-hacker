import { describe, it, expect } from "vitest";

import type { MessageCreatePacketType } from "@/lib/protocol/types";

import { messagePacket } from "@/lib/test/fixtures";

import { isBotMention, isReplyToBot, stripBotMention } from "./mention";

const BOT = "bot-123";

function data(
  content: string,
  overrides: Record<string, unknown> = {},
): MessageCreatePacketType["data"] {
  return messagePacket(content, overrides).data;
}

describe("isBotMention", () => {
  it("matches the standard mention form when the bot is in mentions", () => {
    expect(isBotMention(data(`<@${BOT}> hi`, { mentions: [BOT] }), BOT)).toBe(true);
  });

  it("matches the nickname mention form when the bot is in mentions", () => {
    expect(isBotMention(data(`<@!${BOT}> hi`, { mentions: [BOT] }), BOT)).toBe(true);
  });

  it("rejects leading `<@id>` text when the bot is not in the native mentions array", () => {
    // e.g. pasted as literal text or inside a code fence — Discord's gateway
    // does not include the bot in `mentions` in this case.
    expect(isBotMention(data(`<@${BOT}> hi`, { mentions: [] }), BOT)).toBe(false);
  });

  it("ignores mentions of other users", () => {
    expect(isBotMention(data("<@other> hi", { mentions: ["other"] }), BOT)).toBe(false);
  });

  it("ignores non-mentions", () => {
    expect(isBotMention(data("hello there"), BOT)).toBe(false);
  });

  it("requires the mention at the start", () => {
    expect(isBotMention(data(`oh <@${BOT}> hi`, { mentions: [BOT] }), BOT)).toBe(false);
  });

  it("returns false on empty content", () => {
    expect(isBotMention(data("", { mentions: [BOT] }), BOT)).toBe(false);
  });
});

describe("isReplyToBot", () => {
  const thread = { parentId: "ch-parent", parentName: "parent" };

  it("is true for a thread reply to the bot", () => {
    expect(
      isReplyToBot(data("hi", { thread, reference: { messageId: "msg-0", authorId: BOT } }), BOT),
    ).toBe(true);
  });

  it("is false for a thread reply to someone else", () => {
    expect(
      isReplyToBot(
        data("hi", { thread, reference: { messageId: "msg-0", authorId: "other" } }),
        BOT,
      ),
    ).toBe(false);
  });

  it("is false for a reply to the bot outside a thread", () => {
    expect(
      isReplyToBot(data("hi", { reference: { messageId: "msg-0", authorId: BOT } }), BOT),
    ).toBe(false);
  });

  it("is false in a thread with no reference", () => {
    expect(isReplyToBot(data("hi", { thread }), BOT)).toBe(false);
  });

  it("is false when the referenced author is unknown", () => {
    expect(isReplyToBot(data("hi", { thread, reference: { messageId: "msg-0" } }), BOT)).toBe(
      false,
    );
  });
});

describe("stripBotMention", () => {
  it("strips the standard form", () => {
    expect(stripBotMention(`<@${BOT}> hello world`, BOT)).toBe("hello world");
  });

  it("strips the nickname form", () => {
    expect(stripBotMention(`<@!${BOT}> hello world`, BOT)).toBe("hello world");
  });

  it("trims whitespace after the mention", () => {
    expect(stripBotMention(`<@${BOT}>   hi   `, BOT)).toBe("hi");
  });

  it("returns the content unchanged when no mention present", () => {
    expect(stripBotMention("no mention", BOT)).toBe("no mention");
  });

  it("does not strip mid-message mentions", () => {
    expect(stripBotMention(`hi <@${BOT}>`, BOT)).toBe(`hi <@${BOT}>`);
  });
});
