import { describe, expect, mock, test } from "bun:test";

import { MAX_CONTENT_CHARS } from "@repo/shared/wire";
import { MessageReferenceType, type Attachment, type Message } from "discord.js";

import { fetchReplyTo } from "./message-context.ts";

const CHANNEL_ID = "100000000000000001";
const TARGET_ID = "100000000000000002";
const AUTHOR_ID = "100000000000000003";

function referenceTo(channelId = CHANNEL_ID) {
  return {
    messageId: TARGET_ID,
    channelId,
    guildId: undefined,
    type: MessageReferenceType.Default,
  } satisfies NonNullable<Message["reference"]>;
}

function targetMessage(content = "Your badge and stamp files are ready.") {
  return {
    id: TARGET_ID,
    channelId: CHANNEL_ID,
    content,
    createdAt: new Date("2026-10-12T23:51:00.000Z"),
    author: { id: AUTHOR_ID, username: "wack-hacker", globalName: "Wack Hacker", bot: true },
    attachments: new Map<string, Pick<Attachment, "url" | "name" | "size" | "contentType">>(),
  };
}

function source(target = targetMessage()) {
  const fetchMessage = mock(async (messageId: string) => {
    if (messageId !== TARGET_ID) throw new Error("unexpected history fetch");
    return target;
  });
  return {
    fetchMessage,
    message: { channelId: CHANNEL_ID, channel: { messages: { fetch: fetchMessage } } },
  };
}

describe("Discord reply context", () => {
  test("a standalone request never fetches nearby badge chatter", async () => {
    const { message, fetchMessage } = source();
    expect(await fetchReplyTo(message)).toBeUndefined();
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  test("fetches only the explicit target and preserves its provenance and full text", async () => {
    const content = "Earlier discussion. ".repeat(25) + "Do not publish until reviewed.";
    const { message, fetchMessage } = source(targetMessage(content));
    const replyTo = await fetchReplyTo({ ...message, reference: referenceTo() });
    expect(fetchMessage.mock.calls).toEqual([[TARGET_ID]]);
    expect(replyTo).toEqual({
      messageId: TARGET_ID,
      channelId: CHANNEL_ID,
      snapshot: {
        authorId: AUTHOR_ID,
        authorName: "Wack Hacker",
        isBot: true,
        createdAt: "2026-10-12T23:51:00.000Z",
        content,
        truncated: false,
        attachments: [],
      },
    });
  });

  test("retains an unread target when Discord rejects the fetch", async () => {
    const { message, fetchMessage } = source();
    fetchMessage.mockRejectedValueOnce(new Error("Unknown Message"));
    expect(await fetchReplyTo({ ...message, reference: referenceTo() })).toEqual({
      messageId: TARGET_ID,
      channelId: CHANNEL_ID,
    });
  });

  test("retains cross-channel references without fetching another channel implicitly", async () => {
    const { message, fetchMessage } = source();
    const reference = referenceTo("100000000000000004");
    expect(await fetchReplyTo({ ...message, reference })).toEqual({
      messageId: reference.messageId,
      channelId: reference.channelId,
    });
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  test("does not attach a mismatched snapshot to a reply reference", async () => {
    const target = { ...targetMessage(), id: "100000000000000005" };
    const { message } = source(target);
    expect(await fetchReplyTo({ ...message, reference: referenceTo() })).toEqual({
      messageId: TARGET_ID,
      channelId: CHANNEL_ID,
    });
  });

  test("preserves attachment-only replies and their next reply link without expanding it", async () => {
    const target = {
      ...targetMessage(""),
      reference: { ...referenceTo(), messageId: "100000000000000006" },
    };
    target.attachments.set("attachment", {
      name: "badge.svg",
      url: "https://example.com/badge.svg",
      size: 42,
      contentType: "image/svg+xml",
    });
    const { message, fetchMessage } = source(target);
    const replyTo = await fetchReplyTo({ ...message, reference: referenceTo() });
    expect(replyTo?.snapshot?.content).toBe("");
    expect(replyTo?.snapshot?.attachments).toEqual([
      {
        filename: "badge.svg",
        url: "https://example.com/badge.svg",
        size: 42,
        contentType: "image/svg+xml",
      },
    ]);
    expect(replyTo?.snapshot?.replyTo).toEqual({
      messageId: target.reference.messageId,
      channelId: target.reference.channelId,
    });
    expect(fetchMessage.mock.calls).toEqual([[TARGET_ID]]);
  });

  test("labels truncated content and never splits a surrogate pair", async () => {
    const prefix = "a".repeat(MAX_CONTENT_CHARS - 1);
    const { message } = source(targetMessage(prefix + "😀 more"));
    const replyTo = await fetchReplyTo({ ...message, reference: referenceTo() });
    expect(replyTo?.snapshot?.content).toBe(prefix);
    expect(replyTo?.snapshot?.truncated).toBe(true);
  });
});
