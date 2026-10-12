import { criterionSchema, staticPassed } from "@repo/badges/contracts";
import type { Review } from "@repo/badges/contracts";
import { reviewLabels, reviewPrompt, reviewStep } from "@repo/badges/presentation";
import { cardSchema, componentId } from "@repo/badges/wire";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import type { z } from "zod";

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
  if (step === "done" || step === "publishing") return [];
  if (review.approval) return [row(button("Retry", "retry"))];
  if (!review.rolesConfirmed) {
    return [
      review.uploads.length === 2
        ? row(
            button("A is badge · B is stamp", "roles0"),
            button("B is badge · A is stamp", "roles1"),
          )
        : row(button("Replace badge", "badge"), button("Replace stamp", "stamp")),
    ];
  }
  const components: Row[] = [];
  const criterion = criterionSchema.safeParse(step).data;
  if (criterion)
    components.push(row(button(`Check ${reviewLabels[criterion].toLowerCase()}`, criterion)));
  if (step === "publish") components.push(row(button("Publish", "publish", ButtonStyle.Success)));
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
              description: event.date,
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
              label: `${layout.count} badges · ${layout.widthIn} × ${layout.heightIn} in`,
              value: layout.id,
              default: review.selectedLayout === layout.id,
            })),
          ),
      ),
    );
  return components;
}

export function cardText(review: Review): string {
  return reviewPrompt(review);
}
