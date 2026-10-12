import {
  BADGES_CHANNEL_ID,
  remainingCriteria,
  ready,
  reviewable,
  staticPassed,
} from "@repo/badges";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { runtime } from "./runtime.ts";

function principal(ctx: ToolContext) {
  const auth = ctx.session.auth.current;
  const attributes = z
    .object({
      channelId: z.literal(BADGES_CHANNEL_ID),
      guildId: z.literal(DISCORD_GUILD_ID),
      threadId: z.string().min(1),
      discordMessageId: z.string().min(1),
    })
    .parse(auth?.attributes);
  if (auth?.authenticator !== "discord" || !auth.principalId)
    throw new Error("A Discord badge-thread principal is required.");
  return { ...attributes, userId: auth.principalId };
}
export async function reviewStatus(ctx: ToolContext): Promise<string> {
  try {
    const scoped = principal(ctx),
      stored = await runtime().store.forThread(scoped.threadId);
    if (!stored)
      return JSON.stringify({
        next: "Attach badge and stamp SVGs, ping wack hacker, and ask to submit them.",
      });
    const { review } = stored;
    return JSON.stringify({
      ...stored,
      staticPassed: staticPassed(review),
      reviewable: reviewable(review),
      remainingCriteria: remainingCriteria(review),
      readyToPublish: ready(review),
      evidencePolicy:
        "Static checks are evidence-scoped. A human must inspect images; the assistant must not infer pixel content or record approvals.",
    });
  } catch (cause) {
    return JSON.stringify({ error: messageOf(cause) });
  }
}
export async function submitFiles(ctx: ToolContext): Promise<string> {
  try {
    const scoped = principal(ctx);
    const saved = await runtime().service.submit(scoped.discordMessageId, scoped.threadId);
    if (saved.review.author.id !== scoped.userId)
      throw new Error("Only the author can submit these files.");
    return JSON.stringify({
      reviewId: saved.review.id,
      next: "Identify badge and stamp using the A/B preview buttons. The review card updates on the next worker tick (within one minute).",
    });
  } catch (cause) {
    return JSON.stringify({ error: messageOf(cause) });
  }
}
