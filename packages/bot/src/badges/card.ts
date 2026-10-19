import { remainingCriteria, reviewable } from "@purduehackers/badges/contracts";
import { materialDescription } from "@purduehackers/badges/materials";
import {
  dimensions,
  displayDate,
  fixRole,
  reviewPrompt,
  reviewStep,
  verificationChecks,
  sheetLabel,
} from "@purduehackers/badges/presentation";
import type { ReviewStep } from "@purduehackers/badges/presentation";
import { cardSchema, componentId } from "@purduehackers/badges/wire";
import { ButtonStyle, ComponentType } from "discord.js";
import type {
  APIEmbed,
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIButtonComponentWithCustomId,
} from "discord.js";
import type { z } from "zod";

import { button, link, row } from "./components.ts";
import { badgeColors } from "./messages.ts";

export type BadgeCard = z.output<typeof cardSchema>;
const titles: Record<ReviewStep, string> = {
  files: "Which one is the badge?",
  missing: "Add your other design",
  upload: "Upload your revision",
  event: "Choose a Hack Night",
  material: "Choose your acrylic",
  checking: "Checking files",
  preparing: "Preparing previews",
  fix: "Update your design",
  qa: "Check your designs",
  quantity: "Plan production",
  packing: "Arranging badges",
  layout: "Ready to make",
  publishing: "Saving files",
  done: "Files ready",
  error: "Needs attention",
};

export function controls(
  { review, version, events, availableSheets, viewerUrl }: BadgeCard,
  secret: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const action = (
    label: string,
    name: string,
    style: APIButtonComponentWithCustomId["style"] = ButtonStyle.Secondary,
  ) => button(label, componentId(review.id, version, name, secret), style);
  const upload = (role: "badge" | "stamp") =>
    action(`Upload ${review[role] ? "revised " : ""}${role}`, `upload.${role}`);
  const step = reviewStep(review);
  switch (step) {
    case "files":
      return [
        review.uploads.length === 2
          ? row(
              ...review.uploads.map((asset, index) =>
                action(`${asset.name.slice(0, 60)} is the badge`, `roles.${index}`),
              ),
            )
          : row(action("Badge", "replace.badge"), action("Stamp", "replace.stamp")),
      ];
    case "missing":
      return [row(upload(review.badge ? "stamp" : "badge"))];
    case "upload":
      return [
        row(upload(review.pendingRole ?? "badge"), action("Keep current design", "keep-design")),
      ];
    case "event": {
      if (!events.length) return [row(action("Check again", "refresh"))];
      return Array.from({ length: Math.ceil(events.length / 25) }, (_, page) =>
        row({
          type: ComponentType.StringSelect,
          custom_id: componentId(review.id, version, "event", secret),
          placeholder: "Choose a Hack Night",
          options: events.slice(page * 25, (page + 1) * 25).map((event) => ({
            label: event.name,
            value: event.id,
            description: displayDate(event.date),
          })),
        }),
      );
    }
    case "material":
      return [
        row(
          availableSheets.length
            ? action("Choose acrylic", "material")
            : action("Check again", "refresh"),
        ),
      ];
    case "fix":
      return [row(upload(fixRole(review)))];
    case "qa":
      return [
        row(upload("badge"), upload("stamp"), action("Change acrylic", "choose-material")),
        row(
          ...(viewerUrl ? [link("View in 3D", viewerUrl)] : []),
          action("Confirm designs", "confirm", ButtonStyle.Success),
        ),
      ];
    case "quantity":
      return [
        row(
          action("80 badges", "quantity.80", ButtonStyle.Primary),
          action("100 badges", "quantity.100", ButtonStyle.Primary),
          action("Enter quantity", "quantity.custom"),
          action("Change sheets", "sheets"),
        ),
      ];
    case "layout":
      return [
        row(
          action("Publish cutting files", "publish", ButtonStyle.Success),
          action("Change quantity", "quantity.custom"),
          action("Change sheets", "sheets"),
        ),
      ];
    case "error": {
      const retry = row(
        action("Try again", review.contextChanged ? "refresh" : "retry", ButtonStyle.Primary),
      );
      if (
        !review.contextChanged &&
        !review.approval &&
        reviewable(review) &&
        !remainingCriteria(review).length
      )
        retry.components.push(action("Change sheets", "sheets"));
      return [retry];
    }
    case "done":
      return review.publication?.shortlink
        ? [row(link("Download files", review.publication.shortlink))]
        : [];
    default:
      return [];
  }
}

export function cardEmbeds(card: BadgeCard): APIEmbed[] {
  const { review } = card;
  const step = reviewStep(review);
  let color = badgeColors.warning;
  if (step === "done") color = badgeColors.success;
  if (step === "error" || step === "fix") color = badgeColors.error;
  const embed: APIEmbed = {
    title: titles[step],
    description: reviewPrompt(review),
    color,
  };
  if (card.files[0]) embed.image = { url: `attachment://${card.files[0].name}` };
  if (step === "material" && !card.availableSheets.length) {
    embed.title = "Acrylic is out of stock";
    embed.description = "Ask an organizer to add acrylic sheets, then select Check again.";
  }
  if (step === "fix") {
    const results = verificationChecks(review, fixRole(review));
    if (!results.some((check) => check.status === "fail")) {
      embed.title = "Couldn’t verify this design";
      embed.color = badgeColors.warning;
    }
    const findings = results
      .map((check) => `${{ pass: "✅", fail: "❌", unknown: "❔" }[check.status]} ${check.label}`)
      .join("\n");
    embed.description = `${findings}\n\n${embed.description}`;
  }
  if (step === "qa" && review.event && review.manufacturing) {
    const [year, month, day] = review.event.date.split("-");
    embed.description =
      "Check the version, date, readability, and thin connections. Make sure the stamp impression looks right.";
    embed.fields = [
      {
        name: "Version",
        value: review.event.version,
        inline: true,
      },
      {
        name: "Date",
        value: `${month}/${day}/${year}`,
        inline: true,
      },
    ];
  }
  if (step === "quantity" && !review.quantityShortfall)
    embed.description = "How many badges do you want to make? Choose a target or enter your own.";
  if (step === "quantity" && review.sheetBatch)
    embed.fields = [
      {
        name: "Sheets from stock",
        value: review.sheetBatch
          .map(
            (sheet) =>
              `${sheet.material ? `${materialDescription(sheet.material)} · ` : ""}${sheetLabel(sheet)} in — ${sheet.quantity} ${sheet.quantity === 1 ? "sheet" : "sheets"}`,
          )
          .join("\n"),
      },
    ];
  if (step === "layout") {
    const layout = review.layouts.find((item) => item.id === review.selectedLayout);
    if (layout)
      embed.fields = [
        { name: "Badge size", value: dimensions(layout.widthIn, layout.heightIn), inline: true },
        { name: "Count", value: String(layout.count), inline: true },
        {
          name: "Sheets",
          value: layout.sheetSizes
            .map(
              (size, sheet) =>
                `Sheet ${sheet + 1}: ${layout.placements.filter((p) => p.sheet === sheet).length} on ${sheetLabel(size)} in${size.material ? ` · ${materialDescription(size.material)}` : ""}`,
            )
            .join("\n"),
        },
      ];
    embed.footer = { text: "Publishing saves the files and deducts the sheets used." };
  }
  if (step === "done") embed.footer = { text: `Designed by ${review.author.username}` };
  return [embed];
}
