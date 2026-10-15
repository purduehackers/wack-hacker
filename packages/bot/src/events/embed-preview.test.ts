import { describe, expect, mock, test } from "bun:test";

import { Result } from "@repo/shared/result";
import { MessageFlags } from "discord.js";
import type { MessageEditOptions, MessageReplyOptions } from "discord.js";

import { embedPreviewFor } from "../integrations/embed-links.ts";
import { replyWithEmbedPreview } from "./embed-preview.ts";

const MESSAGE_ID = "100000000000000001";
const URL = "https://x.com/NASAWebb/status/1572558249307639809";
const FX_URL = "https://fx.purduehackers.com/t/NASAWebb/status/1572558249307639809";

function source(embeds: { url: string }[] = [{ url: FX_URL }]) {
  const effects: string[] = [];
  const fetch = mock(async () => ({ embeds }));
  const edit = mock(async (options: MessageEditOptions) => {
    effects.push("fallback");
    return options;
  });
  const reply = mock(async (options: MessageReplyOptions) => {
    effects.push("reply");
    expect(options.content).toContain("fx.purduehackers.com");
    return { embeds, fetch, edit };
  });
  const suppressEmbeds = mock(async (suppress: boolean) => {
    effects.push("suppress");
    return suppress;
  });
  return { message: { id: MESSAGE_ID, reply, suppressEmbeds }, effects, fetch, edit };
}

describe("Embedfix preview delivery", () => {
  test("replies silently and only then suppresses the original", async () => {
    const { message, effects } = source();
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL));
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "suppress"]);
    expect(message.reply.mock.calls).toEqual([
      [
        {
          content: "[\u2800](https://fx.purduehackers.com/t/NASAWebb/status/1572558249307639809)",
          allowedMentions: { parse: [], repliedUser: false },
          flags: MessageFlags.SuppressNotifications,
          nonce: `${MESSAGE_ID}:fx`,
          enforceNonce: true,
        },
      ],
    ]);
    expect(message.suppressEmbeds.mock.calls).toEqual([[true]]);
  });

  test("leaves the original untouched if the send fails", async () => {
    const { message } = source();
    message.reply.mockRejectedValueOnce(new Error("network unavailable"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL));
    expect(Result.isError(outcome)).toBe(true);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
  });

  test("reports a suppression failure without repeating the successful reply", async () => {
    const { message } = source();
    message.suppressEmbeds.mockRejectedValueOnce(new Error("missing permission"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL));
    expect(Result.isError(outcome)).toBe(true);
    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  test("preserves unrelated embeds while sending the replacement", async () => {
    const { message, effects } = source();
    const outcome = await replyWithEmbedPreview(
      message,
      embedPreviewFor(`${URL} https://example.com`),
    );
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply"]);
  });

  test("does nothing without a supported post link", async () => {
    const { message, effects } = source();
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor("hello"));
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual([]);
  });

  test("waits for all platforms before suppressing a message with multiple posts", async () => {
    const instagram = "https://fx.purduehackers.com/i/p/BQ0eAlwhDrw";
    const soundcloud = "https://fx.purduehackers.com/s/artist/track";
    const { message, effects, fetch, edit } = source();
    fetch.mockResolvedValueOnce({
      embeds: [{ url: FX_URL }, { url: instagram }, { url: soundcloud }],
    });
    const outcome = await replyWithEmbedPreview(
      message,
      embedPreviewFor(
        `${URL} https://instagram.com/p/BQ0eAlwhDrw https://soundcloud.com/artist/track`,
      ),
      async () => {},
    );
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "suppress"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
  });
});

describe("Embedfix preview unfurl recovery", () => {
  test("waits for a delayed embed before suppressing the original", async () => {
    const { message, fetch, edit, effects } = source([]);
    const sleep = mock(async () => {});
    fetch.mockResolvedValueOnce({ embeds: [{ url: FX_URL }] });
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), sleep);
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "suppress"]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
  });

  test("reveals the URL and preserves the original when unfurling times out", async () => {
    const { message, edit, effects } = source([]);
    const sleep = mock(async () => {});
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), sleep);
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "fallback"]);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(edit.mock.calls).toEqual([
      [{ content: FX_URL, allowedMentions: { parse: [], repliedUser: false } }],
    ]);
  });

  test("reveals all links if only some posts unfurl", async () => {
    const { message, edit } = source();
    const otherPost = "https://x.com/example/status/123";
    const outcome = await replyWithEmbedPreview(
      message,
      embedPreviewFor(`${URL} ${otherPost}`),
      async () => {},
    );
    expect(Result.isOk(outcome)).toBe(true);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
    expect(edit.mock.calls[0]?.[0].content).toBe(
      `${FX_URL}\nhttps://fx.purduehackers.com/t/example/status/123`,
    );
  });

  test("falls back safely if fetching the generated embeds fails", async () => {
    const { message, fetch, effects } = source([]);
    fetch.mockRejectedValueOnce(new Error("network unavailable"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), async () => {});
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "fallback"]);
  });

  test("reports a failed fallback edit without hiding the original", async () => {
    const { message, edit } = source([]);
    edit.mockRejectedValueOnce(new Error("message deleted"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), async () => {});
    expect(Result.isError(outcome)).toBe(true);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
  });
});
