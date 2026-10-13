import { BADGES_CHANNEL_ID, remainingCriteria, ready, staticPassed } from "@repo/badges";
import {
  currentDecisions,
  designerText,
  failureGuidance,
  findingGuidance,
  reviewLabels,
  reviewPrompt,
} from "@repo/badges/presentation";
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
        next: "Attach your badge and stamp SVGs and mention wack hacker.",
      });
    const { review } = stored;
    const layout = review.layouts.find((item) => item.id === review.selectedLayout);
    return JSON.stringify({
      next: reviewPrompt(review),
      event: review.event
        ? { name: review.event.name, version: review.event.version, date: review.event.date }
        : undefined,
      sizes: review.manufacturing
        ? {
            badge: [review.manufacturing.badgeWidthIn, review.manufacturing.badgeHeightIn],
            stamp: [review.manufacturing.stampWidthIn, review.manufacturing.stampHeightIn],
          }
        : undefined,
      latestReview: review.cardId
        ? `https://discord.com/channels/${DISCORD_GUILD_ID}/${review.threadId}/${review.cardId}`
        : undefined,
      layout: layout
        ? { count: layout.count, widthIn: layout.widthIn, heightIn: layout.heightIn }
        : undefined,
      checks: staticPassed(review) ? "SVG checks passed." : "SVG checks are not complete.",
      remainingReviews: remainingCriteria(review).map((criterion) => reviewLabels[criterion]),
      findings: review.checks
        .filter((finding) => finding.status !== "pass")
        .map((finding) => ({ role: finding.role, guidance: findingGuidance(finding) })),
      decisions: currentDecisions(review).map(({ criterion, verdict, note }) => ({
        item: reviewLabels[criterion],
        verdict,
        note: designerText(note, "The reviewer left no additional note."),
      })),
      publication: review.publication?.shortlink
        ? "Published."
        : review.publication
          ? "Files are saved. Retry the download link."
          : review.approval
            ? "Saving the approved files."
            : ready(review)
              ? "Ready for final approval."
              : "Not ready to publish.",
      pullRequest: review.pr?.url,
      published: review.publication?.shortlink,
    });
  } catch (cause) {
    return JSON.stringify({ error: failureGuidance(messageOf(cause)) });
  }
}
