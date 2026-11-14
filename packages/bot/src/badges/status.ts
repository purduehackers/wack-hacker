import { reviewMaterials } from "@purduehackers/badges/contracts";
import type { Review } from "@purduehackers/badges/contracts";
import { materialDescription } from "@purduehackers/badges/materials";
import { displayDate } from "@purduehackers/badges/presentation";
import { remainingCriteria, staticPassed } from "@purduehackers/badges/review";
import { sheetLabel } from "@purduehackers/badges/sheets";
import { AttachmentBuilder, escapeMarkdown } from "discord.js";
import type { APIEmbed, Message } from "discord.js";

import type { BadgeCard } from "./card.ts";
import { messageControls } from "./components.ts";
import { badgeColors } from "./messages.ts";

const confirmed = `✅ **Automatic QA passed**
-# - Allowed colors
-# - Vector artwork
-# - Outlined text
-# - No red-filled artwork
-# - Closed cutting outlines
-# - No unsupported effects or linked artwork

✅ **Manual QA passed**
-# - Correct version and date
-# - Readable details
-# - Strong connections
-# - Clear stamp impression`;

function completedDesign(commands: string[], review: Review): APIEmbed | undefined {
  if (commands.includes("confirm") && !remainingCriteria(review).length)
    return staticPassed(review)
      ? { description: confirmed }
      : { title: "Design checks pending", color: badgeColors.warning };
  if (commands.some((name) => /^material(?:\.|$)/u.test(name)) && reviewMaterials(review).length)
    return {
      title: "Acrylic Selected",
      description:
        review.sheetBatch
          ?.map(
            (sheet) =>
              `${sheet.quantity} × ${sheet.material ? materialDescription(sheet.material) : "Acrylic"} · ${sheetLabel(sheet)} in`,
          )
          .join("\n") ?? reviewMaterials(review).map(materialDescription).join("\n"),
    };
  if (commands.includes("event") && review.event)
    return {
      title: "Hack Night selected",
      description: `${escapeMarkdown(review.event.name)}\n${displayDate(review.event.date)}`,
    };
  if (review.rolesConfirmed && commands.some((name) => /^(?:roles|replace)\./u.test(name)))
    return {
      title: review.badge ? "Badge Selected" : "Stamp Selected",
      description: (["badge", "stamp"] as const)
        .flatMap((role) =>
          review[role]
            ? [`${role === "badge" ? "Badge" : "Stamp"}: **${escapeMarkdown(review[role].name)}**`]
            : [],
        )
        .join("\n"),
    };
  return undefined;
}

function completedDetails(
  message: Pick<Message, "components">,
  { review }: BadgeCard,
): APIEmbed | "delete" | undefined {
  const commands = messageControls(message).flatMap((component) =>
    "customId" in component && component.customId?.startsWith(`badge:${review.id}:`)
      ? [component.customId.split(":")[3] ?? ""]
      : [],
  );
  const design = completedDesign(commands, review);
  if (design) return design;
  if (commands.includes("publish") && review.approval)
    return review.publication?.shortlink
      ? { title: "Files published" }
      : { title: "Saving files", color: badgeColors.warning };
  if (commands.includes("sheets")) return "delete";
  if (commands.some((name) => name.startsWith("quantity."))) return "delete";
  if (commands.includes("keep-design") && !review.pendingRole)
    return { title: "Current design kept" };
  if (commands.includes("retry")) return "delete";
  if (commands.includes("refresh") && !review.contextChanged) return { title: "Details updated" };
  if (commands.includes("confirm") && !reviewMaterials(review).length) return undefined;
  const upload = commands.find((name) => name.startsWith("upload."));
  if (upload) {
    if (review.pendingRole)
      return { title: `Replacing ${review.pendingRole}`, color: badgeColors.warning };
    return { title: `${upload.endsWith("stamp") ? "Stamp" : "Badge"} updated` };
  }
  return undefined;
}

/** Both button and chat actions settle here, immediately before the next card is acknowledged. */
export function settledCard(message: Pick<Message, "components" | "embeds">, card: BadgeCard) {
  if (
    card.review.publication?.shortlink &&
    message.embeds.some((embed) => embed.title === "Saving files")
  )
    return "delete";
  let embed = completedDetails(message, card);
  if (!embed || embed === "delete") return embed;
  if (card.review.failure || card.review.contextChanged)
    embed = { title: "Needs attention", color: badgeColors.error };
  const keepPreview = ["Badge Selected", "Stamp Selected"].includes(embed.title ?? "");
  const file = keepPreview ? card.identifiedFile : undefined;
  if (file) embed.image = { url: `attachment://${file.name}` };
  const color = embed.color ?? badgeColors.success;
  if (embed.title && color === badgeColors.success) embed.title = `✅ ${embed.title}`;
  return {
    embeds: [{ ...embed, color }],
    components: [],
    attachments: [],
    ...(file
      ? { files: [new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name })] }
      : {}),
    allowedMentions: { parse: [] },
  };
}
