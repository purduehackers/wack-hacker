import type { Review } from "@repo/badges/contracts";
import { materialDescription } from "@repo/badges/materials";
import {
  correctionFor,
  currentDecisions,
  reviewLabels,
  reviewStep,
} from "@repo/badges/presentation";
import type { Action } from "@repo/badges/wire";
import { AttachmentBuilder, ComponentType, escapeMarkdown } from "discord.js";
import type { APIEmbed, Message } from "discord.js";

import { badgeColors } from "./messages.ts";
import type { BadgeStatus } from "./messages.ts";

interface StepResult {
  status: BadgeStatus;
  label: string;
  description?: string;
  selectedFiles?: boolean;
}
type CardMessage = Pick<Message, "embeds" | "components"> & Partial<Pick<Message, "attachments">>;
const continued: StepResult = { status: "warning", label: "Continued below" };

export function reviewStatus(review: Review): BadgeStatus {
  const step = reviewStep(review);
  if (
    step === "error" ||
    correctionFor(review)?.verdict === "changes" ||
    (step === "fix" && review.checks.some((check) => check.status === "fail"))
  )
    return "error";
  return step === "done" ? "success" : "warning";
}

export function actionResult(action: Action, review: Review): StepResult {
  if (review.failure || review.contextChanged) return { status: "error", label: "Needs attention" };
  switch (action.kind) {
    case "decision":
      return action.verdict === "approve"
        ? { status: "success", label: `${reviewLabels[action.criterion]} confirmed` }
        : {
            status: action.verdict === "changes" ? "error" : "warning",
            label: "Check your design",
          };
    case "material":
      return materialResult(review);
    case "event":
      return { status: "success", label: "Hack Night selected" };
    case "roles":
    case "replace":
      return filesResult(review);
    case "upload":
      return { status: "warning", label: `New ${action.role} uploaded` };
    case "publish":
      return pendingResult("publish", review);
    case "repack":
      return { status: "warning", label: "Arranging badges…" };
    case "quantity":
      return {
        status: "warning",
        label: action.count ? `Target: ${action.count} badges` : "Choosing quantity",
      };
    case "retry":
      return { status: "warning", label: "Trying again…" };
    case "choose-material":
      return { status: "warning", label: "Choosing another acrylic" };
    case "refresh":
    case "keep-design":
      return continued;
  }
}

function materialResult(review: Review): StepResult {
  return {
    status: "success",
    label: "Acrylic Selected",
    ...(review.material ? { description: materialDescription(review.material) } : {}),
  };
}
function filesResult(review: Review): StepResult {
  return {
    status: "success",
    label: review.badge ? "Badge Selected" : "Stamp Selected",
    description: (["badge", "stamp"] as const)
      .flatMap((role) =>
        review[role] ? [`${reviewLabels[role]}: **${escapeMarkdown(review[role].name)}**`] : [],
      )
      .join("\n"),
    selectedFiles: true,
  };
}

function pendingResult(kind: string, review: Review): StepResult {
  if (review.failure || review.contextChanged) return { status: "error", label: "Needs attention" };
  if (kind === "publish")
    return review.publication?.shortlink
      ? { status: "success", label: "Files published" }
      : { status: "warning", label: "Saving files…" };
  return kind === "retry" ? { status: "success", label: "Resolved" } : continued;
}

function messageComponents(message: CardMessage) {
  return message.components.flatMap((row) =>
    row.type === ComponentType.ActionRow ? row.components : [],
  );
}

function completedResult(message: CardMessage, review: Review): StepResult | undefined {
  const items = messageComponents(message);
  const embed = message.embeds.at(-1);
  if (embed?.title === "✅ Badge Selected" || embed?.title === "✅ Stamp Selected")
    return {
      ...filesResult(review),
      ...(embed.description ? { description: embed.description } : {}),
    };
  if (embed?.title === "Saving files…") return pendingResult("publish", review);
  if (embed?.title === "Trying again…") return pendingResult("retry", review);
  if (!items.length && embed?.title)
    return {
      status: statusOf(embed.color ?? undefined),
      label: embed.title.replace(/^✅ /u, ""),
    };
  const result = items.find(
    (component) =>
      component.type === ComponentType.Button && component.customId?.startsWith("badge-result:"),
  );
  if (result?.type === ComponentType.Button) {
    const kind = result.customId?.slice("badge-result:".length) ?? "complete";
    if (kind !== "complete") return pendingResult(kind, review);
    if (result.label === "Files identified") return filesResult(review);
    if (result.label === "Acrylic selected") return materialResult(review);
    const color = message.embeds.at(-1)?.color;
    return {
      status: statusOf(color ?? undefined),
      label: result.label ?? continued.label,
    };
  }
  return undefined;
}

/** Recover completion after a restart or an upload sent directly in the thread. */
export function deliveredResult(message: CardMessage, review: Review): StepResult {
  const completed = completedResult(message, review);
  if (completed) return completed;
  const items = messageComponents(message);
  const commands = items.flatMap((component) =>
    "customId" in component && component.customId?.startsWith(`badge:${review.id}:`)
      ? [component.customId.split(":")[3] ?? ""]
      : [],
  );
  for (const role of ["badge", "stamp"] as const) {
    if (commands.includes(`review.${role}.approve`))
      return currentDecisions(review).some(
        (decision) => decision.criterion === role && decision.verdict === "approve",
      )
        ? { status: "success", label: `${reviewLabels[role]} confirmed` }
        : continued;
  }
  if (commands.some((action) => action.startsWith("material.")) && review.material)
    return materialResult(review);
  if (commands.includes("event") && review.event)
    return { status: "success", label: "Hack Night selected" };
  if (commands.some((action) => /^(?:roles|replace)\./u.test(action)) && review.rolesConfirmed)
    return filesResult(review);
  if (commands.includes("publish") && review.approval) return pendingResult("publish", review);
  if (commands.includes("retry")) return pendingResult("retry", review);
  return continued;
}

function statusOf(color: number | undefined): BadgeStatus {
  return color === badgeColors.success
    ? "success"
    : color === badgeColors.error
      ? "error"
      : "warning";
}

function attachedImage(embed: APIEmbed, message: CardMessage): APIEmbed {
  if (!embed.image) return embed;
  const attachment = [...(message.attachments?.values() ?? [])].find(
    (file) =>
      file.url.split("?")[0] === embed.image?.url.split("?")[0] ||
      file.proxyURL.split("?")[0] === embed.image?.url.split("?")[0],
  );
  return attachment ? { ...embed, image: { url: `attachment://${attachment.name}` } } : embed;
}

/** Completed cards record the selection and retain inline images without any buttons. */
export function settledCard(
  message: CardMessage,
  result: StepResult,
  identifiedFile?: { name: string; data: string },
) {
  const file = result.selectedFiles ? identifiedFile : undefined;
  return {
    embeds: message.embeds.map((embed, index) => {
      const original = attachedImage(embed.toJSON(), message);
      if (index !== message.embeds.length - 1 || original.title === "Automatic verification")
        return original;
      return {
        ...original,
        title: `${result.status === "success" ? "✅ " : ""}${result.label}`,
        color: badgeColors[result.status],
        ...(result.description === undefined ? {} : { description: result.description }),
        ...(file ? { image: { url: `attachment://${file.name}` } } : {}),
      };
    }),
    components: [],
    ...(file
      ? {
          attachments: [],
          files: [new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name })],
        }
      : {}),
    allowedMentions: { parse: [] },
  };
}
