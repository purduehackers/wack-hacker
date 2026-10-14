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
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { z } from "zod";

import { badgeColors } from "./messages.ts";

export type BadgeCard = z.output<typeof cardSchema>;
type Row = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;
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

function eventMenus(
  { review, version, events }: Pick<BadgeCard, "review" | "version" | "events">,
  secret: string,
): Row[] {
  const options = events.map((event) => ({
    label: event.name,
    value: event.id,
    description: displayDate(event.date),
  }));
  const menus: Row[] = [];
  for (let offset = 0; offset < options.length; offset += 25)
    menus.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(componentId(review.id, version, "event", secret))
          .setPlaceholder("Choose a Hack Night")
          .addOptions(options.slice(offset, offset + 25)),
      ),
    );
  return menus;
}

export function controls(
  { review, version, events, materials, viewerUrl }: BadgeCard,
  secret: string,
): Row[] {
  const button = (label: string, action: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(componentId(review.id, version, action, secret))
      .setLabel(label)
      .setStyle(style);
  const row = (...buttons: ButtonBuilder[]) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  const upload = (role: "badge" | "stamp") =>
    button(`Upload ${review[role] ? "revised " : ""}${role}`, `upload.${role}`);
  const step = reviewStep(review);
  switch (step) {
    case "files":
      return [
        review.uploads.length === 2
          ? row(
              ...review.uploads.map((asset, index) =>
                button(`${asset.name.slice(0, 60)} is the badge`, `roles.${index}`),
              ),
            )
          : row(button("Badge", "replace.badge"), button("Stamp", "replace.stamp")),
      ];
    case "missing":
      return [row(upload(review.badge ? "stamp" : "badge"))];
    case "upload":
      return [
        row(upload(review.pendingRole ?? "badge"), button("Keep current design", "keep-design")),
      ];
    case "material":
    case "event": {
      const menus =
        step === "event"
          ? eventMenus({ review, version, events }, secret)
          : materials.length
            ? [row(button("Choose acrylic colors", "material"))]
            : [];
      return menus.length ? menus : [row(button("Check again", "refresh"))];
    }
    case "fix":
      return [row(upload(fixRole(review)))];
    case "qa": {
      const confirmation = row();
      if (viewerUrl)
        confirmation.addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("View in 3D").setURL(viewerUrl),
        );
      confirmation.addComponents(button("Confirm designs", "confirm", ButtonStyle.Success));
      return [
        row(upload("badge"), upload("stamp"), button("Change acrylic", "choose-material")),
        confirmation,
      ];
    }
    case "quantity":
      return [
        row(
          button("80 badges", "quantity.80", ButtonStyle.Primary),
          button("100 badges", "quantity.100", ButtonStyle.Primary),
          button("Enter quantity", "quantity.custom"),
          button("Change sheets", "sheets"),
        ),
      ];
    case "layout":
      return [
        row(
          button("Publish cutting files", "publish", ButtonStyle.Success),
          button("Change quantity", "quantity.custom"),
          button("Change sheets", "sheets"),
        ),
      ];
    case "error": {
      const retry = row(
        button("Try again", review.contextChanged ? "refresh" : "retry", ButtonStyle.Primary),
      );
      if (
        !review.contextChanged &&
        !review.approval &&
        reviewable(review) &&
        !remainingCriteria(review).length
      )
        retry.addComponents(button("Change sheets", "sheets"));
      return [retry];
    }
    case "done":
      return review.publication?.shortlink
        ? [
            row(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Download files")
                .setURL(review.publication.shortlink),
            ),
          ]
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
  if (step === "material" && !card.materials.length) {
    embed.title = "Acrylic is out of stock";
    embed.description = "Ask an organizer to add acrylic sheets, then select Check again.";
  }
  if (step === "fix") {
    const findings = verificationChecks(review, fixRole(review))
      .map((check) => `${check.status === "pass" ? "✅" : "❌"} ${check.label}`)
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
