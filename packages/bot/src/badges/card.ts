import {
  contextHash,
  ready,
  remainingCriteria,
  reviewable,
  staticPassed,
} from "@repo/badges/contracts";
import type { Review } from "@repo/badges/contracts";
import { cardSchema, componentId } from "@repo/badges/wire";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import type { z } from "zod";

export type BadgeCard = z.output<typeof cardSchema>;
type Row = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

export function controls(card: BadgeCard, secret: string): Row[] {
  const { review, version } = card;
  const token = (action: string) => componentId(review.id, version, action, secret);
  const button = (label: string, action: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(token(action)).setLabel(label).setStyle(style);
  const row = (...buttons: ButtonBuilder[]) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  if (review.publication?.shortlink) return [];
  if (review.approval) return [row(button("Retry publication", "retry"))];
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
  if (card.events.length)
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(token("event"))
          .setPlaceholder("CMS event (changing resets review)")
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
  components.push(
    row(
      button(review.settings ? "Change settings" : "Set material & sizes", "settings"),
      button("Refresh CMS event", "refresh"),
      button("Retry failed work", "retry"),
    ),
  );
  if (review.layouts.length)
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(token("layout"))
          .setPlaceholder("Choose an audited layout")
          .addOptions(
            review.layouts.map((layout) => ({
              label: `${layout.count} badges · ${layout.widthIn} × ${layout.heightIn} in`,
              value: layout.id,
              default: review.selectedLayout === layout.id,
            })),
          ),
      ),
    );
  if (reviewable(review))
    components.push(
      row(
        ...["version", "date", "physical", "stamp"].map((criterion) =>
          button(`Review ${criterion}`, criterion),
        ),
      ),
    );
  if (ready(review))
    components.push(row(button("Approve & publish this revision", "publish", ButtonStyle.Success)));
  return components;
}

export function cardText(review: Review): string {
  const failures = review.checks.filter((check) => check.status !== "pass");
  const expected = review.event
    ? `${review.event.name} · expected date **${review.event.date}**`
    : "Choose the CMS event.";
  const state = review.publication?.shortlink
    ? `Published: ${review.publication.shortlink}`
    : review.approval
      ? "Publication approved; waiting for verified GitHub and shortlink receipts."
      : !review.rolesConfirmed
        ? "Identify the files using the A/B previews below. Filenames are not used."
        : staticPassed(review)
          ? "Static checks passed for badge and stamp."
          : review.checks.length
            ? "Static checks need attention:"
            : "Static checks queued.";
  const settings = review.settings
    ? `${review.settings.material} · badges ${review.settings.minSizeIn}–${review.settings.maxSizeIn} in · gap ${review.settings.gapMm} mm · stamp ${review.settings.stampSizeIn} in (${review.settings.mirrorStamp ? "mirrored" : "not mirrored"})`
    : "Confirm material, physical sizes, spacing, and stamp mirroring.";
  const decisions = review.decisions
    .filter((d) => d.context === contextHash(review))
    .map((d) => `${d.criterion}: ${d.verdict}${d.note ? ` — ${d.note.slice(0, 140)}` : ""}`)
    .join("\n");
  return [
    `**Badge review · revision ${review.generation + 1}**`,
    expected,
    state,
    ...failures.map(
      (finding) =>
        `• ${finding.role}/${finding.id} (${finding.status}): ${finding.detail.slice(0, 130)}`,
    ),
    review.rolesConfirmed ? settings : "",
    review.layouts.length
      ? "Packing: one 12×12 + one 12×18 sheet, 0.2-in margins. Valid heuristic layouts; no optimality claim. Stamps use a separate material job."
      : "",
    reviewable(review)
      ? `Organizer review remaining: ${remainingCriteria(review).join(", ") || "none"}. Inspect the full images AND overlapping crops. Date/version apply to the badge; do not require stamp text.`
      : "",
    decisions,
    review.pr
      ? `Reviewed repository revision: ${review.pr.url} (\`${review.pr.head.slice(0, 8)}\`). The organizer who completed the last criterion must approve publication.`
      : "",
    review.failure ? `**Needs attention:** ${review.failure.slice(0, 350)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);
}
