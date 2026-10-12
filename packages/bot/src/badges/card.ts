import { criterionSchema, staticPassed } from "@repo/badges/contracts";
import {
  dimensions,
  displayDate,
  reviewLabels,
  reviewPrompt,
  reviewStep,
} from "@repo/badges/presentation";
import type { ReviewStep } from "@repo/badges/presentation";
import { cardSchema, componentId } from "@repo/badges/wire";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import type { z } from "zod";

import { badgeEmbed } from "./messages.ts";

export type BadgeCard = z.output<typeof cardSchema>;
type Row = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

export function controls(card: BadgeCard, secret: string): Row[] {
  const { review, version } = card;
  const step = reviewStep(review);
  const token = (action: string) => componentId(review.id, version, action, secret);
  const button = (label: string, action: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(token(action)).setLabel(label).setStyle(style);
  const row = (...buttons: ButtonBuilder[]) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  if (review.publication?.shortlink)
    return [
      row(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Download the designs")
          .setURL(review.publication.shortlink),
      ),
    ];
  if (step === "publishing") return [];
  if (review.approval) return [row(button("Retry", "retry"))];
  if (!review.rolesConfirmed) {
    return [
      review.uploads.length === 2
        ? row(button("Design A is the badge", "roles0"), button("Design B is the badge", "roles1"))
        : row(button("Replace badge", "badge"), button("Replace stamp", "stamp")),
    ];
  }
  const components: Row[] = [];
  const criterion = criterionSchema.safeParse(step).data;
  if (criterion)
    components.push(
      row(
        button(`Review ${reviewLabels[criterion].toLowerCase()}`, criterion, ButtonStyle.Primary),
      ),
    );
  if (step === "publish" && review.pr)
    components.push(
      row(
        button("Publish designs", "publish", ButtonStyle.Primary),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("View finished files")
          .setURL(
            review.pr.url.replace(
              /\/pull\/\d+$/u,
              `/blob/${review.pr.head}/badges/${review.event?.version}/README.md`,
            ),
          ),
      ),
    );
  if (!staticPassed(review) && step !== "error") return components;
  if (card.events.length)
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(token("event"))
          .setPlaceholder("Choose the Hack Night")
          .addOptions(
            card.events.map((event) => ({
              label: event.name,
              description: displayDate(event.date),
              value: event.id,
              default: review.event?.id === event.id,
            })),
          ),
      ),
    );
  if (review.event)
    components.push(
      row(button(review.settings ? "Change setup" : "Set material & sizes", "settings")),
    );
  if (step === "error")
    components.push(
      row(button("Retry", "retry"), ...(review.event ? [button("Refresh event", "refresh")] : [])),
    );
  if (step === "layout" || step === "physical")
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(token("layout"))
          .setPlaceholder("Choose a size and count")
          .addOptions(
            review.layouts.map((layout) => ({
              label: `${layout.count} badges, ${dimensions(layout.widthIn, layout.heightIn)}`,
              value: layout.id,
              default: review.selectedLayout === layout.id,
            })),
          ),
      ),
    );
  return components;
}

const titles: Record<ReviewStep, string> = {
  files: "Which design is the badge?",
  checking: "Checking your designs",
  fix: "A few design changes",
  event: "Choose a Hack Night",
  settings: "Choose your material and sizes",
  packing: "Finding a good fit",
  layout: "Choose a size and quantity",
  preparing: "Preparing your previews",
  version: "Check the version",
  date: "Check the date",
  physical: "Check the details",
  stamp: "Check the stamp",
  archiving: "Getting the files ready",
  publish: "Ready to publish",
  publishing: "Saving the finished designs",
  done: "Your designs are ready",
  error: "This step needs another look",
};

function previewTitle(card: BadgeCard, index: number): string {
  const step = reviewStep(card.review);
  if (step === "files") return `Design ${index === 0 ? "A" : "B"}`;
  if (step === "layout") {
    const layout = card.review.layouts[index];
    return layout
      ? `Option ${index + 1}: ${layout.count} badges, ${dimensions(layout.widthIn, layout.heightIn)}`
      : "Sheet preview";
  }
  if (step === "stamp") return index === 0 ? "Original stamp" : "Stamp as it will be cut";
  if (step === "fix") return card.files[index]?.name === "stamp.png" ? "Your stamp" : "Your badge";
  return index === 0 ? "Full badge" : "Close-up views";
}

export function cardEmbeds(card: BadgeCard) {
  const { review } = card;
  const step = reviewStep(review);
  const title =
    !review.rolesConfirmed && review.uploads.length === 1
      ? "Which design are you updating?"
      : titles[step];
  const [first, ...rest] = card.files;
  return [
    {
      ...badgeEmbed(reviewPrompt(review), title),
      ...(first
        ? { image: { url: `attachment://${first.name}` }, footer: { text: previewTitle(card, 0) } }
        : {}),
    },
    ...rest.map((file, index) => ({
      title: previewTitle(card, index + 1),
      image: { url: `attachment://${file.name}` },
      color: 0xffcc00,
    })),
  ];
}
