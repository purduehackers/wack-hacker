import {
  remainingCriteria,
  staticPassed,
  reviewMaterials,
  type Review,
} from "@purduehackers/badges/contracts";
import { materialDescription } from "@purduehackers/badges/materials";
import { displayDate, sheetLabel } from "@purduehackers/badges/presentation";
import type { Action } from "@purduehackers/badges/wire";
import { AttachmentBuilder, ComponentType, escapeMarkdown } from "discord.js";
import type { APIEmbed, Message } from "discord.js";

import { badgeColors } from "./messages.ts";
import type { BadgeStatus } from "./messages.ts";

interface StepResult {
  status: BadgeStatus;
  label?: string;
  description?: string;
  selectedFiles?: boolean;
  keepPreview?: boolean;
}
type CardMessage = Pick<Message, "embeds" | "components"> & Partial<Pick<Message, "attachments">>;

export function actionResult(action: Action, review: Review): StepResult | undefined {
  if (review.failure || review.contextChanged) return { status: "error", label: "Needs attention" };
  switch (action.kind) {
    case "confirm":
      if (!staticPassed(review) || remainingCriteria(review).length)
        return { status: "warning", label: "Design checks pending" };
      return {
        status: "success",
        description: [
          "✅ **Automatic QA passed**",
          "-# - Allowed colors",
          "-# - Vector artwork",
          "-# - Outlined text",
          "-# - Filled engraving",
          "-# - Closed cutting outlines",
          "-# - No unsupported effects or linked artwork",
          "",
          "✅ **Manual QA passed**",
          "-# - Correct version and date",
          "-# - Readable details",
          "-# - Strong connections",
          "-# - Clear stamp impression",
        ].join("\n"),
      };
    case "material":
      return {
        status: "success",
        label: "Acrylic Selected",
        description: reviewMaterials(review).map(materialDescription).join("\n"),
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
        keepPreview: true,
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
      return action.file
        ? { status: "success", label: `New ${action.role} uploaded` }
        : { status: "warning", label: `Replacing ${action.role}` };
    case "publish":
      return review.publication?.shortlink
        ? { status: "success", label: "Files published" }
        : { status: "warning", label: "Saving files" };
    case "quantity":
      return { status: "success", label: `Target: ${action.count ?? review.targetCount} badges` };
    case "sheets":
      return {
        status: "success",
        label: "Sheets updated",
        ...(review.sheetBatch
          ? {
              description: review.sheetBatch
                .map(
                  (sheet) =>
                    `${sheet.material ? `${materialDescription(sheet.material)} · ` : ""}${sheetLabel(sheet)} in — ${sheet.quantity} ${sheet.quantity === 1 ? "sheet" : "sheets"}`,
                )
                .join("\n"),
            }
          : {}),
      };
    case "layout":
      return { status: "success", label: "Layout selected" };
    case "choose-material":
      return undefined;
    case "keep-design":
      return { status: "success", label: "Current design kept" };
    case "retry":
      return { status: "warning", label: "Retrying" };
    case "refresh":
      return { status: "warning", label: "Checking again" };
  }
}

function revisionResult(commands: string[], review: Review): StepResult | undefined {
  if (commands.includes("keep-design") && !review.pendingRole)
    return actionResult({ kind: "keep-design" }, review);
  if (commands.includes("retry") && !review.failure)
    return { status: "success", label: "Retry complete" };
  if (commands.includes("refresh") && !review.contextChanged)
    return { status: "success", label: "Details updated" };
  if (commands.includes("confirm") && !reviewMaterials(review).length)
    return actionResult({ kind: "choose-material" }, review);
  const upload = commands.find((name) => name.startsWith("upload."));
  if (!upload) return undefined;
  const role = upload.endsWith("stamp") ? "stamp" : "badge";
  return review.pendingRole
    ? actionResult({ kind: "upload", role: review.pendingRole }, review)
    : { status: "success", label: `${role === "badge" ? "Badge" : "Stamp"} updated` };
}

function progressResult(title: string | undefined, review: Review): StepResult | undefined {
  switch (title) {
    case "Checking again":
    case "Retrying":
      return review.failure || review.contextChanged
        ? { status: "error", label: "Needs attention" }
        : { status: "success", label: "Check complete" };
    case "Saving files":
      return actionResult({ kind: "publish" }, review);
    default:
      return undefined;
  }
}

export function deliveredResult(message: CardMessage, review: Review): StepResult | undefined {
  const commands = message.components
    .flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
    .flatMap((component) =>
      "customId" in component && component.customId?.startsWith(`badge:${review.id}:`)
        ? [component.customId.split(":")[3] ?? ""]
        : [],
    );
  if (commands.includes("confirm") && !remainingCriteria(review).length)
    return actionResult({ kind: "confirm" }, review);
  if (
    commands.some((name) => name === "material" || name.startsWith("material.")) &&
    reviewMaterials(review).length
  )
    return actionResult(
      { kind: "material", ids: reviewMaterials(review).map((material) => material.materialId) },
      review,
    );
  if (commands.includes("event") && review.event)
    return actionResult({ kind: "event", id: review.event.id }, review);
  if (commands.some((name) => /^(?:roles|replace)\./u.test(name)) && review.rolesConfirmed)
    return actionResult({ kind: "roles", badge: 0 }, review);
  if (commands.includes("publish") && review.approval)
    return actionResult({ kind: "publish" }, review);
  if (commands.includes("sheets")) return { status: "success", label: "Production updated" };
  if (commands.some((name) => name.startsWith("quantity.")) && review.targetCount)
    return actionResult({ kind: "quantity", count: review.targetCount }, review);
  const last = message.embeds.at(-1);
  if (
    review.rolesConfirmed &&
    ["✅ Badge Selected", "✅ Stamp Selected"].includes(last?.title ?? "")
  )
    return actionResult({ kind: "roles", badge: 0 }, review);
  return revisionResult(commands, review) ?? progressResult(last?.title ?? undefined, review);
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
      ...(result.label
        ? { title: `${result.status === "success" ? "✅ " : ""}${result.label}` }
        : {}),
      color: badgeColors[result.status],
      ...(result.description === undefined ? {} : { description: result.description }),
      ...(result.keepPreview ? { image: attachedImage(embed.toJSON(), message).image } : {}),
      ...(file ? { image: { url: `attachment://${file.name}` } } : {}),
    })),
    components: [],
    ...(file
      ? {
          attachments: [],
          files: [new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name })],
        }
      : result.keepPreview
        ? {}
        : { attachments: [] }),
    allowedMentions: { parse: [] },
  };
}
