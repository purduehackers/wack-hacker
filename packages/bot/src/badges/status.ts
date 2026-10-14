import { remainingCriteria, type Review } from "@purduehackers/badges/contracts";
import { materialDescription } from "@purduehackers/badges/materials";
import { displayDate } from "@purduehackers/badges/presentation";
import type { Action } from "@purduehackers/badges/wire";
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

export function actionResult(action: Action, review: Review): StepResult {
  if (review.failure || review.contextChanged) return { status: "error", label: "Needs attention" };
  switch (action.kind) {
    case "confirm":
      return {
        status: "success",
        label: "Designs confirmed",
        description: "Ready for production. Your design checks are complete.",
      };
    case "material":
      return {
        status: "success",
        label: "Acrylic Selected",
        ...(review.material ? { description: materialDescription(review.material) } : {}),
      };
    case "event":
      return {
        status: "success",
        label: "Hack Night selected",
        ...(review.event
          ? {
              description: `${escapeMarkdown(review.event.name)}\n${displayDate(review.event.date)}`,
            }
          : {}),
      };
    case "roles":
    case "replace":
      return {
        status: "success",
        label: review.badge ? "Badge Selected" : "Stamp Selected",
        selectedFiles: true,
        description: (["badge", "stamp"] as const)
          .flatMap((role) =>
            review[role]
              ? [
                  `${role === "badge" ? "Badge" : "Stamp"}: **${escapeMarkdown(review[role].name)}**`,
                ]
              : [],
          )
          .join("\n"),
      };
    case "upload":
      return { status: "warning", label: `New ${action.role} uploaded` };
    case "publish":
      return review.publication?.shortlink
        ? { status: "success", label: "Files published" }
        : { status: "warning", label: "Saving files" };
    case "quantity":
      return { status: "success", label: `Target: ${action.count ?? review.targetCount} badges` };
    case "layout":
      return { status: "success", label: "Layout selected" };
    default:
      return continued;
  }
}

export function deliveredResult(message: CardMessage, review: Review): StepResult {
  const commands = message.components
    .flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
    .flatMap((component) =>
      "customId" in component && component.customId?.startsWith(`badge:${review.id}:`)
        ? [component.customId.split(":")[3] ?? ""]
        : [],
    );
  if (commands.includes("confirm") && !remainingCriteria(review).length)
    return actionResult({ kind: "confirm" }, review);
  if (commands.some((name) => name.startsWith("material.")) && review.material)
    return actionResult({ kind: "material", id: review.material.materialId }, review);
  if (commands.includes("event") && review.event)
    return actionResult({ kind: "event", id: review.event.id }, review);
  if (commands.some((name) => /^(?:roles|replace)\./u.test(name)) && review.rolesConfirmed)
    return actionResult({ kind: "roles", badge: 0 }, review);
  if (commands.includes("publish") && review.approval)
    return actionResult({ kind: "publish" }, review);
  const last = message.embeds.at(-1);
  if (
    review.rolesConfirmed &&
    ["✅ Badge Selected", "✅ Stamp Selected"].includes(last?.title ?? "")
  )
    return actionResult({ kind: "roles", badge: 0 }, review);
  if (!commands.length && last?.title?.startsWith("✅ "))
    return { status: "success", label: last.title.slice(2).trim() };
  return continued;
}

function attachedImage(embed: APIEmbed, message: CardMessage): APIEmbed {
  if (!embed.image) return embed;
  const attachment = [...(message.attachments?.values() ?? [])].find(
    (file) => file.url.split("?")[0] === embed.image?.url.split("?")[0],
  );
  const hosted =
    /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\d+\/\d+\/([^/?#]+)/u.exec(
      embed.image.url,
    )?.[1];
  const name = attachment?.name ?? (hosted ? decodeURIComponent(hosted) : undefined);
  return name ? { ...embed, image: { url: `attachment://${name}` } } : embed;
}

export function settledCard(
  message: CardMessage,
  result: StepResult,
  identifiedFile?: { name: string; data: string },
) {
  const file = result.selectedFiles ? identifiedFile : undefined;
  return {
    embeds: message.embeds.map((embed) => ({
      ...attachedImage(embed.toJSON(), message),
      title: `${result.status === "success" ? "✅ " : ""}${result.label}`,
      color: badgeColors[result.status],
      ...(result.description === undefined ? {} : { description: result.description }),
      ...(file ? { image: { url: `attachment://${file.name}` } } : {}),
    })),
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
