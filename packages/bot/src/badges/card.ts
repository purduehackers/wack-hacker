import {
  correctionFor,
  dimensions,
  displayDate,
  fixRole,
  reviewPrompt,
  reviewStep,
} from "@repo/badges/presentation";
import type { ReviewStep } from "@repo/badges/presentation";
import { cardSchema, componentId } from "@repo/badges/wire";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { z } from "zod";

import { badgeEmbed } from "./messages.ts";

export type BadgeCard = z.output<typeof cardSchema>;
type Row = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;
export function controls(card: BadgeCard, secret: string): Row[] {
  const { review, version } = card;
  const step = reviewStep(review),
    correction = correctionFor(review);
  const button = (label: string, action: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(componentId(review.id, version, action, secret))
      .setLabel(label)
      .setStyle(style);
  const row = (...buttons: ButtonBuilder[]) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  const upload = (role: "badge" | "stamp", style = ButtonStyle.Primary) =>
    button(`Upload ${review[role] ? "revised " : ""}${role}`, `upload.${role}`, style);
  switch (step) {
    case "files":
      return [
        review.uploads.length === 2
          ? row(button("A is the badge", "roles.0"), button("B is the badge", "roles.1"))
          : row(button("Badge", "replace.badge"), button("Stamp", "replace.stamp")),
      ];
    case "missing":
      return [row(upload(review.badge ? "stamp" : "badge"))];
    case "fix":
      return [row(upload(fixRole(review)))];
    case "event":
      return card.events.length
        ? [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(componentId(review.id, version, "event", secret))
                .setPlaceholder("Choose a Hack Night")
                .addOptions(
                  card.events.slice(0, 25).map((event) => ({
                    label: event.name,
                    value: event.id,
                    description: displayDate(event.date),
                  })),
                ),
            ),
          ]
        : [row(button("Check for events", "refresh"))];
    case "badge":
    case "stamp":
      return correction?.verdict === "changes"
        ? [row(upload(step))]
        : [
            row(
              button(`Confirm ${step}`, `review.${step}.approve`, ButtonStyle.Success),
              upload(step, ButtonStyle.Secondary),
              ...(step === "badge" && card.viewerUrl
                ? [
                    new ButtonBuilder()
                      .setStyle(ButtonStyle.Link)
                      .setLabel("View in 3D")
                      .setURL(card.viewerUrl),
                  ]
                : []),
            ),
          ];
    case "layout":
      return [
        row(
          button("Publish files", "publish", ButtonStyle.Success),
          button("Try another layout", "repack"),
        ),
      ];
    case "error":
      if (review.contextChanged)
        return [row(button("Check again", "refresh", ButtonStyle.Primary))];
      if (review.publication)
        return [
          row(
            button("Retry link", "retry", ButtonStyle.Primary),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel("View saved files")
              .setURL(review.publication.url),
          ),
        ];
      if (!review.approval && /layout search|time budget/iu.test(review.failure ?? ""))
        return [row(button("Try another layout", "repack"), button("Check again", "refresh"))];
      return [row(button("Try again", "retry", ButtonStyle.Primary))];
    case "done":
      return review.publication?.shortlink
        ? [
            row(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Get the files")
                .setURL(review.publication.shortlink),
              upload("badge"),
              upload("stamp"),
            ),
          ]
        : [];
    default:
      return [];
  }
}
const titles: Record<ReviewStep, string> = {
  files: "Which one is the badge?",
  missing: "One more file",
  checking: "Checking your files…",
  fix: "Update the design",
  event: "Choose a Hack Night",
  preparing: "Preparing your designs…",
  badge: "Check your badge",
  stamp: "Check your stamp",
  packing: "Arranging your badges…",
  layout: "Ready to publish",
  publishing: "Saving your files…",
  done: "Your files are ready",
  error: "Continue with your designs",
};
export function cardEmbeds(card: BadgeCard): [APIEmbed] {
  const { review } = card,
    step = reviewStep(review);
  const title = cardTitle(card);
  const embed = badgeEmbed(reviewPrompt(review), title);
  if (card.files[0]) embed.image = { url: `attachment://${card.files[0].name}` };
  if (step === "badge" && review.event && review.manufacturing) {
    embed.fields = [
      { name: "Event", value: review.event.name, inline: true },
      { name: "Date", value: displayDate(review.event.date), inline: true },
      {
        name: "Badge size",
        value: dimensions(review.manufacturing.badgeWidthIn, review.manufacturing.badgeHeightIn),
        inline: true,
      },
    ];
    if (review.manufacturing.badge3d)
      embed.footer = {
        text: `Example material: ${review.manufacturing.badge3d.material}. Check fine details in your design.`,
      };
  }
  if (step === "stamp" && review.manufacturing) {
    embed.fields = [
      {
        name: "Stamp size",
        value: dimensions(review.manufacturing.stampWidthIn, review.manufacturing.stampHeightIn),
        inline: true,
      },
      { name: "Preview", value: "Finished impression", inline: true },
    ];
    embed.footer = {
      text: "I’ll mirror the cutting file for you",
    };
  }
  if (step === "layout" && review.manufacturing) {
    embed.fields = [
      {
        name: "Badge size",
        value: dimensions(review.manufacturing.badgeWidthIn, review.manufacturing.badgeHeightIn),
        inline: true,
      },
      {
        name: "Sheets",
        value:
          review.stockPlan
            ?.map((sheet) => `One ${sheet.widthIn} × ${sheet.heightIn} in`)
            .join(" · ") ?? "One 12 × 12 in · One 12 × 18 in",
        inline: true,
      },
    ];
    if (review.stockPlan)
      embed.fields.push({
        name: "Material",
        value: review.stockPlan.map((sheet) => sheet.label).join("\n"),
      });
    embed.footer = { text: "Publishing saves the files and deducts the acrylic sheets used" };
  }
  if (step === "done")
    embed.footer = {
      text: `Designed by ${review.author.username}`,
    };
  return [embed];
}

function cardTitle(card: BadgeCard) {
  const { review } = card,
    step = reviewStep(review),
    correction = correctionFor(review);
  return correction?.verdict === "changes"
    ? `Update the ${correction.criterion}`
    : step === "fix"
      ? `Update the ${fixRole(review)}`
      : step === "done"
        ? `${review.event?.name ?? "Your badge"} is ready`
        : step === "error" && review.publication
          ? "Your files are saved"
          : titles[step];
}
