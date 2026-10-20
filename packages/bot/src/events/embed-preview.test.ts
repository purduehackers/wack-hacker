import { describe, expect, mock, test } from "bun:test";

import { Result } from "@repo/shared/result";
import { MessageFlags } from "discord.js";
import type { MessageEditOptions, MessageReplyOptions } from "discord.js";

import { embedPreviewFor } from "../integrations/embed-links.ts";
import { replyWithEmbedPreview } from "./embed-preview.ts";

const MESSAGE_ID = "100000000000000001";
const URL = "https://x.com/NASAWebb/status/1572558249307639809";
const FX_URL = "https://fx.purduehackers.com/t/NASAWebb/status/1572558249307639809";

function source() {
  const effects: string[] = [];
  const edit = mock(async (options: MessageEditOptions) => {
    effects.push(options.content?.startsWith("[\u2800]") ? "refresh" : "fallback");
    return options;
  });
  const reply = mock(async (options: MessageReplyOptions) => {
    effects.push("reply");
    expect(options.content).toContain("fx.purduehackers.com");
    return { id: "reply-id", embeds: [], fetch: mock(async () => ({ embeds: [] })), edit };
  });
  const suppressEmbeds = mock(async (suppress: boolean) => {
    effects.push("suppress");
    return suppress;
  });
  const deps = {
    dedup: { claim: mock(async (_key: string) => true) },
    waitForPreviews: mock(async (_message: { id: string }, _urls: readonly string[]) => true),
    sleep: mock(async (_milliseconds: number) => {}),
  };
  return { message: { id: MESSAGE_ID, reply, suppressEmbeds }, effects, edit, deps };
}

describe("Embedfix preview delivery", () => {
  test("replies silently and only then suppresses the original", async () => {
    const { message, effects, deps } = source();
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "suppress"]);
    expect(message.reply.mock.calls).toEqual([
      [
        {
          content: `[\u2800](${FX_URL})`,
          allowedMentions: { parse: [], repliedUser: false },
          flags: MessageFlags.SuppressNotifications,
          nonce: `${MESSAGE_ID}:fx`,
          enforceNonce: true,
        },
      ],
    ]);
    expect(deps.dedup.claim.mock.calls).toEqual([[`embed-preview:${MESSAGE_ID}`]]);
    expect(message.suppressEmbeds.mock.calls).toEqual([[true]]);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  test("does not touch Redis or Discord for messages without supported links", async () => {
    const { message, deps } = source();
    for (const content of [
      "hello",
      "https://github.com/purduehackers/wack-hacker",
      "https://soundcloud.com/artist/track",
      "https://soundcloud.com/artist/sets/playlist",
      "https://on.soundcloud.com/Abc123Def",
      `<${URL}>`,
      `\`${URL}\``,
    ]) {
      expect(
        Result.isOk(await replyWithEmbedPreview(message, embedPreviewFor(content), deps)),
      ).toBe(true);
    }
    expect(deps.dedup.claim).not.toHaveBeenCalled();
    expect(deps.waitForPreviews).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });

  test("waits for the Redis claim before replying and skips duplicate delivery", async () => {
    const { message, deps } = source();
    const claim = Promise.withResolvers<boolean>();
    deps.dedup.claim.mockReturnValueOnce(claim.promise);
    const sending = replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(message.reply).not.toHaveBeenCalled();
    claim.resolve(false);
    expect(Result.isOk(await sending)).toBe(true);
    expect(message.reply).not.toHaveBeenCalled();
    expect(deps.waitForPreviews).not.toHaveBeenCalled();
  });

  test("leaves the original untouched if the send fails", async () => {
    const { message, deps } = source();
    message.reply.mockRejectedValueOnce(new Error("network unavailable"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isError(outcome)).toBe(true);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
  });

  test("reports a suppression failure without repeating the successful reply", async () => {
    const { message, deps } = source();
    message.suppressEmbeds.mockRejectedValueOnce(new Error("missing permission"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isError(outcome)).toBe(true);
    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  test("preserves SoundCloud embeds while sending a supported replacement", async () => {
    const { message, effects, deps } = source();
    const outcome = await replyWithEmbedPreview(
      message,
      embedPreviewFor(`${URL} https://soundcloud.com/artist/track`),
      deps,
    );
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply"]);
  });

  test("waits for all platforms before suppressing the original", async () => {
    const { message, effects, deps } = source();
    const ready = Promise.withResolvers<boolean>();
    deps.waitForPreviews.mockReturnValueOnce(ready.promise);
    const preview = embedPreviewFor(`${URL} https://instagram.com/p/BQ0eAlwhDrw`);
    const sending = replyWithEmbedPreview(message, preview, deps);
    await Bun.sleep(0);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
    ready.resolve(true);
    expect(Result.isOk(await sending)).toBe(true);
    expect(deps.waitForPreviews.mock.calls[0]?.[1]).toEqual(preview.links);
    expect(effects).toEqual(["reply", "suppress"]);
  });
});

describe("Embedfix preview unfurl recovery", () => {
  test("keeps visible links and the original when both attempts time out", async () => {
    const { message, edit, effects, deps } = source();
    deps.waitForPreviews.mockResolvedValue(false);
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "fallback", "refresh", "fallback"]);
    expect(deps.waitForPreviews).toHaveBeenCalledTimes(2);
    expect(deps.sleep.mock.calls).toEqual([[5_000]]);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
    expect(edit.mock.calls.map(([options]) => options.content)).toEqual([
      FX_URL,
      `[\u2800](${FX_URL})`,
      FX_URL,
    ]);
  });

  test("reveals all links if only some posts unfurl", async () => {
    const { message, edit, deps } = source();
    deps.waitForPreviews.mockResolvedValue(false);
    const outcome = await replyWithEmbedPreview(
      message,
      embedPreviewFor(`${URL} https://x.com/example/status/123`),
      deps,
    );
    expect(Result.isOk(outcome)).toBe(true);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
    expect(edit.mock.calls[0]?.[0].content).toBe(
      `${FX_URL}\nhttps://fx.purduehackers.com/t/example/status/123`,
    );
  });

  test("falls back safely if checking the generated embeds fails", async () => {
    const { message, effects, deps } = source();
    deps.waitForPreviews.mockRejectedValueOnce(new Error("network unavailable"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "fallback"]);
  });

  test("reports a failed fallback edit without hiding the original", async () => {
    const { message, edit, deps } = source();
    deps.waitForPreviews.mockResolvedValue(false);
    edit.mockRejectedValueOnce(new Error("message deleted"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isError(outcome)).toBe(true);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
  });

  test("recovers from the initial timeout by refreshing the same reply once", async () => {
    const { message, effects, deps } = source();
    deps.waitForPreviews.mockResolvedValueOnce(false);
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isOk(outcome)).toBe(true);
    expect(effects).toEqual(["reply", "fallback", "refresh", "suppress"]);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(deps.sleep.mock.calls).toEqual([[5_000]]);
  });

  test("restores visible links if the retry edit fails", async () => {
    const { message, edit, deps } = source();
    deps.waitForPreviews.mockResolvedValue(false);
    edit
      .mockResolvedValueOnce({ content: FX_URL })
      .mockRejectedValueOnce(new Error("network unavailable"));
    const outcome = await replyWithEmbedPreview(message, embedPreviewFor(URL), deps);
    expect(Result.isOk(outcome)).toBe(true);
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.suppressEmbeds).not.toHaveBeenCalled();
    expect(edit.mock.calls.at(-1)?.[0].content).toBe(FX_URL);
  });
});
