import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageFlags } from "discord.js";
import type { MessageReplyOptions } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import type { Deduplicator } from "../framework/events.ts";
import { findGitHubCodeLinks } from "../integrations/github-code.ts";
import type { GitHubCodeClient } from "../integrations/github-code.ts";

export async function replyWithGitHubCode(
  message: {
    readonly id: string;
    readonly content: string;
    readonly reply: (options: MessageReplyOptions) => Promise<unknown>;
    readonly suppressEmbeds: (suppress: boolean) => Promise<unknown>;
  },
  deps: {
    readonly github: GitHubCodeClient;
    readonly dedup: Deduplicator;
  },
) {
  const links = findGitHubCodeLinks(message.content);
  if (links.length === 0) return Result.ok(undefined);

  // Overlap Redis with downloads; require the claim before replying.
  const [claimed, outcomes] = await Promise.all([
    deps.dedup.claim(`github-code-preview:${message.id}`),
    Promise.all(links.map(deps.github.preview)),
  ]);
  if (!claimed) return Result.ok(undefined);
  const [previews, errors] = Result.partition(outcomes);
  const embeds = previews.filter((preview) => preview !== undefined);
  if (embeds.length > 0) {
    const sent = await Result.tryPromise({
      try: () =>
        message.reply({
          embeds,
          allowedMentions: { parse: [], repliedUser: false },
          flags: MessageFlags.SuppressNotifications,
        }),
      catch: (cause) =>
        new Transient({ operation: "send GitHub code preview", detail: messageOf(cause) }),
    });
    if (Result.isError(sent)) return sent;

    // Keep the original preview if its replacement could not be sent. Suppressing
    // the message flag also prevents a delayed Discord unfurl from appearing.
    const suppressed = await Result.tryPromise({
      try: () => message.suppressEmbeds(true),
      catch: (cause) =>
        new Transient({ operation: "suppress GitHub link embeds", detail: messageOf(cause) }),
    });
    if (Result.isError(suppressed)) return suppressed;
  }
  return errors[0] === undefined ? Result.ok(undefined) : Result.err(errors[0]);
}

export function githubCodePreview(github: GitHubCodeClient, dedup: Deduplicator) {
  return defineEvent({
    name: "github-code-preview",
    kind: "message",
    handle: async (message, context) => {
      if (
        context.isBotMention ||
        !message.inGuild() ||
        message.flags.has(MessageFlags.SuppressEmbeds)
      )
        return Result.ok(undefined);

      return replyWithGitHubCode(message, { github, dedup });
    },
  });
}
