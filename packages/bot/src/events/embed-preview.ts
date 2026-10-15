import { httpStatusOf, messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import type { Embed, MessageEditOptions, MessageReplyOptions } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import { hiddenEmbedLinks, embedPreviewFor } from "../integrations/embed-links.ts";

interface PreviewReply {
  readonly embeds: readonly Pick<Embed, "url">[];
  readonly fetch: () => Promise<{ readonly embeds: PreviewReply["embeds"] }>;
  readonly edit: (options: MessageEditOptions) => Promise<unknown>;
}

async function hasPreviews(
  reply: PreviewReply,
  expectedUrls: readonly string[],
  sleep: (milliseconds: number) => Promise<void>,
) {
  let embeds = reply.embeds;
  for (const delay of [1_000, 2_000, 4_000]) {
    if (expectedUrls.every((url) => embeds.some((candidate) => candidate.url === url))) return true;
    await sleep(delay);
    embeds = (await reply.fetch()).embeds;
  }
  return expectedUrls.every((url) => embeds.some((candidate) => candidate.url === url));
}

function discordFailure(operation: string, cause: unknown) {
  const status = httpStatusOf(cause);
  const detail = messageOf(cause);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
    ? new UpstreamError({ service: "discord", status, detail: `${operation}: ${detail}` })
    : new Transient({ operation, detail });
}

function updateContent(reply: PreviewReply, content: string) {
  return Result.tryPromise({
    try: async () => {
      await reply.edit({ content, allowedMentions: { parse: [], repliedUser: false } });
    },
    catch: (cause) => discordFailure("edit Embedfix preview", cause),
  });
}

export async function replyWithEmbedPreview(
  message: {
    readonly id: string;
    readonly reply: (options: MessageReplyOptions) => Promise<PreviewReply>;
    readonly suppressEmbeds: (suppress: boolean) => Promise<unknown>;
  },
  preview: ReturnType<typeof embedPreviewFor>,
  sleep: (milliseconds: number) => Promise<void> = Bun.sleep,
) {
  if (preview.links.length === 0) return Result.ok(undefined);

  const sent = await Result.tryPromise({
    try: () =>
      message.reply({
        content: hiddenEmbedLinks(preview.links),
        allowedMentions: { parse: [], repliedUser: false },
        flags: MessageFlags.SuppressNotifications,
        nonce: `${message.id}:fx`,
        enforceNonce: true,
      }),
    catch: (cause) => discordFailure("send Embedfix preview", cause),
  });
  if (Result.isError(sent)) return sent;

  const unfurled = await Result.tryPromise({
    try: () => hasPreviews(sent.value, preview.links, sleep),
    catch: (cause) => discordFailure("check Embedfix previews", cause),
  });
  if (Result.isError(unfurled) || !unfurled.value) {
    // Unfurling is asynchronous and Embedfix can be unavailable. A blank-label
    // reply without an embed is invisible, so reveal the URLs on failure.
    const visible = preview.links.join("\n");
    const fallback = await updateContent(sent.value, visible);
    if (Result.isError(fallback) || Result.isError(unfurled)) return fallback;

    // A failed first crawl can leave the message empty even when the same URL
    // later unfurls. Changing the existing reply back to masked links triggers
    // another attempt without another message or a cache-busting URL.
    await sleep(5_000);
    const refreshed = await updateContent(sent.value, hiddenEmbedLinks(preview.links));
    if (Result.isError(refreshed)) return updateContent(sent.value, visible);
    const retried = await Result.tryPromise({
      try: () => hasPreviews(sent.value, preview.links, sleep),
      catch: (cause) => discordFailure("recheck Embedfix previews", cause),
    });
    if (Result.isError(retried) || !retried.value) return updateContent(sent.value, visible);
  }

  // Failed sends and unfurls leave the original intact. Setting the flag also
  // covers originals whose native embed has not arrived yet.
  if (preview.suppressOriginal) {
    const suppressed = await Result.tryPromise({
      try: () => message.suppressEmbeds(true),
      catch: (cause) => discordFailure("suppress source embeds", cause),
    });
    if (Result.isError(suppressed)) return suppressed;
  }

  return Result.ok(undefined);
}

export const embedPreview = defineEvent({
  name: "embed-preview",
  kind: "message",
  dedupKey: (message) => message.id,
  handle: async (message, context) => {
    if (
      context.isBotMention ||
      !message.inGuild() ||
      message.flags.has(MessageFlags.SuppressEmbeds)
    )
      return Result.ok(undefined);

    const preview = embedPreviewFor(message.content);
    if (preview.links.length === 0) return Result.ok(undefined);

    const permissions = message.channel.permissionsFor(context.client.user);
    const sendPermission = message.channel.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages;
    if (
      !permissions?.has([
        PermissionFlagsBits.ViewChannel,
        sendPermission,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ]) ||
      (preview.suppressOriginal && !permissions.has(PermissionFlagsBits.ManageMessages))
    )
      return Result.ok(undefined);

    return replyWithEmbedPreview(message, preview);
  },
});
