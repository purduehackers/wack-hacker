import { materialDescription } from "@repo/badges/materials";
import {
  correctionFor,
  dimensions,
  displayDate,
  fixRole,
  reviewPrompt,
  reviewStep,
  verificationChecks,
  quantityOptions,
} from "@repo/badges/presentation";
import type { ReviewStep } from "@repo/badges/presentation";
import { cardSchema, componentId } from "@repo/badges/wire";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { z } from "zod";

import { badgeColors, badgeEmbed } from "./messages.ts";
import { reviewStatus } from "./status.ts";

export type BadgeCard = z.output<typeof cardSchema>;
type Row = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;
function selectionMenus(card: BadgeCard, secret: string, kind: "material" | "event"): Row[] {
  const options =
    kind === "material"
      ? card.materials.map((material) => ({
          label: materialDescription(material),
          value: material.materialId,
        }))
      : card.events.slice(0, 25).map((event) => ({
          label: event.name,
          value: event.id,
          description: displayDate(event.date),
        }));
  const menus: Row[] = [];
  for (let offset = 0; offset < options.length; offset += 25)
    menus.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            componentId(
              card.review.id,
              card.version,
              kind === "material" ? `material.${offset}` : kind,
              secret,
            ),
          )
          .setPlaceholder(
            kind === "event"
              ? "Choose a Hack Night"
              : offset
                ? "More acrylic choices"
                : "Choose acrylic",
          )
          .addOptions(options.slice(offset, offset + 25)),
      ),
    );
  return menus;
}
function row(...buttons: ButtonBuilder[]) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}
function failureControls(
  review: BadgeCard["review"],
  button: (label: string, action: string, style?: ButtonStyle) => ButtonBuilder,
): Row[] {
  if (review.contextChanged) return [row(button("Check again", "refresh", ButtonStyle.Primary))];
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
    return [row(button("Try again", "retry"), button("Set quantity", "quantity.custom"))];
  if (
    !review.approval &&
    review.material &&
    /acrylic|material|inventory|sheets/iu.test(review.failure ?? "")
  )
    return [row(button("Change material", "choose-material"), button("Try again", "retry"))];
  return [row(button("Try again", "retry", ButtonStyle.Primary))];
}
export function controls(card: BadgeCard, secret: string): Row[] {
  const { review, version } = card;
  const step = reviewStep(review),
    correction = correctionFor(review);
  const button = (label: string, action: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(componentId(review.id, version, action, secret))
      .setLabel(label)
      .setStyle(style);
  const upload = (role: "badge" | "stamp", style = ButtonStyle.Primary) =>
    button(`Upload ${review[role] ? "revised " : ""}${role}`, `upload.${role}`, style);
  switch (step) {
    case "files":
      return [
        review.uploads.length === 2
          ? row(
              ...review.uploads.map((file, index) =>
                button(`${file.name.slice(0, 60)} is the badge`, `roles.${index}`),
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
      return [...selectionMenus(card, secret, "material"), row(button("Check stock", "refresh"))];
    case "fix":
      return [row(upload(fixRole(review)))];
    case "event":
      return card.events.length
        ? selectionMenus(card, secret, "event")
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
              ...(step === "badge" ? [button("Change material", "choose-material")] : []),
            ),
          ];
    case "layout":
      return [
        row(
          button("Publish files", "publish", ButtonStyle.Success),
          button("Change quantity", "quantity"),
          button("Change material", "choose-material"),
        ),
      ];
    case "quantity":
      return [
        row(
          ...quantityOptions(review).map((option) =>
            button(`${option.count} badges`, `quantity.${option.count}`, ButtonStyle.Primary),
          ),
          button("Custom quantity", "quantity.custom"),
        ),
      ];
    case "error":
      return failureControls(review, button);
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
  upload: "Upload your revision",
  material: "Choose your acrylic",
  checking: "Checking your files…",
  fix: "Update the design",
  event: "Choose a Hack Night",
  preparing: "Preparing your designs…",
  badge: "Check your badge",
  stamp: "Check your stamp",
  packing: "Arranging your badges…",
  layout: "Ready to publish",
  quantity: "How many badges?",
  publishing: "Saving your files…",
  done: "Your files are ready",
  error: "Continue with your designs",
};
function automaticVerification(review: BadgeCard["review"], role: "badge" | "stamp") {
  const results = verificationChecks(review, role);
  const status = results.some((check) => check.status === "fail")
    ? "error"
    : results.every((check) => check.status === "pass")
      ? "success"
      : "warning";
  return {
    title: "Automatic verification",
    color: badgeColors[status],
    description: results
      .map((check) =>
        check.status === "pass"
          ? `✅ ${check.label}`
          : `❌ ${check.status === "unknown" ? "Not verified: " : ""}${check.label}`,
      )
      .join("\n"),
  };
}

export function cardEmbeds(card: BadgeCard): APIEmbed[] {
  const { review } = card,
    step = reviewStep(review);
  const title = cardTitle(card);
  const embed = badgeEmbed(reviewPrompt(review), title, reviewStatus(review));
  if (step === "material" && !card.materials.length)
    embed.description =
      "No matching acrylic sheets are available. Ask an organizer to update inventory, then select Check stock.";
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
      ...(review.material
        ? [{ name: "Material", value: materialDescription(review.material) }]
        : []),
    ];
    if (review.manufacturing.badge3d)
      embed.footer = {
        text: "Check fine details in the flat artwork",
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
  if (step === "quantity") {
    embed.fields = quantityFields(review);
    embed.footer = {
      text: "Or tell me “I want 120 badges.” A smaller size needs your confirmation again.",
    };
  }
  if (step === "done")
    embed.footer = {
      text: `Designed by ${review.author.username}`,
    };
  return verificationEmbeds(review, step, embed);
}

function verificationEmbeds(
  review: BadgeCard["review"],
  step: ReviewStep,
  embed: APIEmbed,
): APIEmbed[] {
  if (step === "fix") {
    const automatic = automaticVerification(review, fixRole(review));
    return [
      {
        ...embed,
        ...automatic,
        description: `${automatic.description}\n\n${embed.description}`,
      },
    ];
  }
  if (step === "badge" || step === "stamp")
    return [automaticVerification(review, step), { ...embed, title: "Manual verification" }];
  return [embed];
}

function quantityFields(review: BadgeCard["review"]): NonNullable<APIEmbed["fields"]> {
  if (!review.manufacturing) return [];
  return [
    {
      name: "Badge size",
      value: dimensions(review.manufacturing.badgeWidthIn, review.manufacturing.badgeHeightIn),
    },
    ...quantityOptions(review).map((option) => ({
      name: `${option.count} badges`,
      value: `${option.small} on 12 × 12 in + ${option.large} on 12 × 18 in = ${option.count}`,
    })),
  ];
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
