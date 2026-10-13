import { BADGES_CHANNEL_ID, remainingCriteria, ready, staticPassed } from "@repo/badges";
import { materialDescription } from "@repo/badges/materials";
import {
  currentDecisions,
  designerText,
  failureGuidance,
  findingGuidance,
  reviewLabels,
  reviewPrompt,
  reviewStep,
  quantityOptions,
  verifiedChecks,
} from "@repo/badges/presentation";
import type { Action } from "@repo/badges/wire";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { decodeMessagePayload } from "@repo/shared/wire";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { cms } from "./cms.ts";
import { runtime } from "./runtime.ts";
import { viewerUrl } from "./viewer.ts";

function principal(ctx: ToolContext) {
  const auth = ctx.session.auth.current;
  const attributes = z
    .object({
      channelId: z.literal(BADGES_CHANNEL_ID),
      guildId: z.literal(DISCORD_GUILD_ID),
      threadId: z.string().min(1),
      discordMessageId: z.string().min(1),
      source: z.literal("chat"),
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
      version: stored.version,
      step: reviewStep(review),
      next: reviewPrompt(review),
      isDesigner: scoped.userId === review.author.id,
      event: review.event
        ? { name: review.event.name, version: review.event.version, date: review.event.date }
        : undefined,
      sizes: review.manufacturing
        ? {
            badge: [review.manufacturing.badgeWidthIn, review.manufacturing.badgeHeightIn],
            stamp: [review.manufacturing.stampWidthIn, review.manufacturing.stampHeightIn],
          }
        : undefined,
      material: review.material ? materialDescription(review.material) : undefined,
      materials: (await runtime().inventory.materials()).map((material) => ({
        id: material.materialId,
        label: materialDescription(material),
      })),
      events: await cms.events(),
      files: review.uploads.map((asset, index) => ({
        label: index === 0 ? "A" : "B",
        filename: asset.name,
      })),
      requestedQuantity: review.targetCount,
      quantityOptions: quantityOptions(review),
      quantityShortfall: review.quantityShortfall,
      viewIn3d: process.env.BADGE_AGENT_URL
        ? viewerUrl(review, process.env.BADGE_AGENT_URL)
        : undefined,
      contextChanged: review.contextChanged ?? false,
      failure: review.failure ? failureGuidance(review.failure) : undefined,
      materialPreview: review.manufacturing?.badge3d?.material,
      cuttingSheets: review.stockPlan?.map((sheet) => sheet.label),
      latestReview: review.cardId
        ? `https://discord.com/channels/${DISCORD_GUILD_ID}/${review.threadId}/${review.cardId}`
        : undefined,
      layout: layout
        ? { count: layout.count, widthIn: layout.widthIn, heightIn: layout.heightIn }
        : undefined,
      checks: staticPassed(review) ? "SVG checks passed." : "SVG checks are not complete.",
      verified: { badge: verifiedChecks(review, "badge"), stamp: verifiedChecks(review, "stamp") },
      remainingConfirmations: remainingCriteria(review).map((criterion) => reviewLabels[criterion]),
      findings: review.checks
        .filter((finding) => finding.status !== "pass")
        .map((finding) => ({ role: finding.role, guidance: findingGuidance(finding) })),
      decisions: currentDecisions(review).map(({ criterion, verdict, note }) => ({
        item: reviewLabels[criterion],
        status: verdict === "approve" ? "confirmed" : verdict,
        note: note ? designerText(note) : undefined,
      })),
      publication: review.publication?.shortlink
        ? "Published."
        : review.publication
          ? "Files are saved. Retry the download link."
          : review.approval
            ? "Saving your files."
            : ready(review)
              ? "Ready to publish on the designer’s request."
              : "Not ready to publish.",
      pullRequest: review.pr?.url,
      published: review.publication?.shortlink,
    });
  } catch (cause) {
    return JSON.stringify({ error: failureGuidance(messageOf(cause)) });
  }
}

/** One explicit action per human message, using only identity staged by the Discord bot. */
export async function reviewAction(
  ctx: ToolContext,
  version: number,
  action: Action,
): Promise<string> {
  try {
    const scoped = principal(ctx),
      { store, service } = runtime();
    const document = await store.inbox(scoped.discordMessageId, scoped.threadId);
    if (!document) throw new Error("The current Discord message is unavailable. Mention me again.");
    const decoded = decodeMessagePayload(JSON.parse(document));
    if (
      Result.isError(decoded) ||
      decoded.value.principal.userId !== scoped.userId ||
      decoded.value.thread?.id !== scoped.threadId
    )
      throw new Error("This action does not belong to the current Discord message.");
    const stored = await store.forThread(scoped.threadId);
    if (!stored) throw new Error("Attach your badge and stamp SVGs first.");
    const eventId = `chat:${scoped.discordMessageId}`;
    if (await store.hasEvent(eventId))
      return JSON.stringify({
        changed: false,
        message:
          "This message already changed the workflow. Wait for the designer’s next message before another action.",
      });
    const result = await service.action(
      stored.review.id,
      version,
      {
        person: { id: scoped.userId, username: decoded.value.principal.username },
        memberRoles: decoded.value.principal.memberRoles,
        threadId: scoped.threadId,
        guildId: scoped.guildId,
      },
      action,
      eventId,
    );
    return JSON.stringify({
      changed: true,
      next:
        action.kind === "upload"
          ? `Attach your updated ${action.role} SVG here.`
          : result
            ? reviewPrompt(result.review)
            : "The next step will appear below.",
    });
  } catch (cause) {
    return JSON.stringify({ changed: false, error: failureGuidance(messageOf(cause)) });
  }
}
