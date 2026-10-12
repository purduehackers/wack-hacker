import { criterionSchema, settingsSchema } from "@repo/badges/contracts";
import type { Action } from "@repo/badges/wire";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Interaction, ModalSubmitInteraction } from "discord.js";
import { z } from "zod";

import type { BadgeClient } from "./client.ts";
import { badgeWork } from "./schedule.ts";

const controlSchema = z.tuple([
  z.literal("badge"),
  z.uuid(),
  z.string().regex(/^\d+$/u),
  z.string(),
  z.string(),
]);
const decimal = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/u)
  .transform(Number);
function input(name: string, label: string, value?: string, required = true) {
  const field = new TextInputBuilder()
    .setCustomId(name)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(name === "note" ? 1500 : 100);
  if (value) field.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}
function settingsModal(control: string) {
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Badge manufacturing settings")
    .addComponents(
      input("material", "Badge material (e.g. acrylic)"),
      input("sizes", "Badge longest side, inches: min,max", "2,2.7"),
      input("stamp", "Stamp largest dimension, inches", "1.5"),
      input("mirror", "Mirror the stamp output? yes/no", "yes"),
      input("gap", "Gap between cut outlines, mm", "0.5"),
    );
}
const reviewInstructions = {
  version:
    "Check the full badge and close-ups for the version in the message, including any trailing zeros. If you can’t read it clearly, choose unclear.",
  date: "Check the full badge and close-ups against the event date in the message. If you can’t read it clearly, choose unclear.",
  physical:
    "Inspect at the chosen physical dimensions and material. Engraving lines must be at least 3% of badge size. Check connected geometry, fragile bridges and small details. Essential details should be near black; lighter than #666666 may disappear. Use strong contrast and at most 2–3 grayscale colors (black/white only for a first badge). Compare artwork against the red cut contour: nothing intended to remain may sit outside it.",
  stamp:
    "Inspect both the source and manufacturing preview. The center must be a simplified motif without text or complex items; border text alone is allowed. Engraving is black/white only, largest dimension ≤1.5 inches. Confirm legibility and the requested mirroring. Date/version are not required on a stamp.",
};
function decisionModal(control: string, criterion: keyof typeof reviewInstructions) {
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle(`Check ${criterion === "physical" ? "physical design" : criterion}`)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(reviewInstructions[criterion]))
    .addComponents(
      input("verdict", "Verdict: approve, changes, or unclear"),
      input("note", "What needs fixing / what did you inspect?", undefined, false),
    );
}
function modalAction(interaction: ModalSubmitInteraction, action: string): Action {
  const field = (name: string) => interaction.fields.getTextInputValue(name).trim();
  if (action === "settings") {
    const [minSizeIn, maxSizeIn] = z.tuple([decimal, decimal]).parse(
      field("sizes")
        .split(",")
        .map((part) => part.trim()),
    );
    return {
      kind: "settings",
      value: settingsSchema.parse({
        material: field("material"),
        minSizeIn,
        maxSizeIn,
        stampSizeIn: decimal.parse(field("stamp")),
        mirrorStamp: z.enum(["yes", "no"]).parse(field("mirror").toLowerCase()) === "yes",
        gapMm: decimal.parse(field("gap")),
      }),
    };
  }
  const verdict = z
    .enum(["approve", "changes", "unclear"])
    .safeParse(field("verdict").toLowerCase());
  if (!verdict.success) throw new Error("Enter approve, changes, or unclear, then try again.");
  return {
    kind: "decision",
    criterion: criterionSchema.parse(action),
    verdict: verdict.data,
    note: field("note"),
  };
}

export function createBadgeInteractionHandler(client: BadgeClient, secret: string) {
  return async (interaction: Interaction): Promise<boolean> => {
    if (
      !(
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isModalSubmit()
      ) ||
      !interaction.customId.startsWith("badge:")
    )
      return false;
    try {
      const [, id, version, action] = controlSchema.parse(interaction.customId.split(":"));
      if (
        interaction.isButton() &&
        (action === "settings" || criterionSchema.safeParse(action).success)
      ) {
        await interaction.showModal(
          action === "settings"
            ? settingsModal(interaction.customId)
            : decisionModal(interaction.customId, criterionSchema.parse(action)),
        );
        return true;
      }
      await interaction.deferUpdate();
      if (
        !interaction.guild ||
        interaction.guildId !== DISCORD_GUILD_ID ||
        !interaction.channel?.isThread()
      )
        throw new Error("Badge controls only work in their original server thread.");
      const member = await interaction.guild.members.fetch({
        user: interaction.user.id,
        force: true,
      });
      let command: Action;
      if (interaction.isModalSubmit()) command = modalAction(interaction, action);
      else if (interaction.isStringSelectMenu())
        command = {
          kind: z.enum(["event", "layout"]).parse(action),
          id: z.string().min(1).parse(interaction.values[0]),
        };
      else if (action === "roles0" || action === "roles1")
        command = { kind: "roles", badge: Number(action !== "roles0") };
      else if (action === "badge" || action === "stamp")
        command = { kind: "replace", role: action };
      else command = { kind: z.enum(["publish", "retry", "refresh"]).parse(action) };
      await client.post("action", {
        id,
        version: Number(version),
        control: interaction.customId,
        action: command,
        eventId: interaction.id,
        actor: {
          person: { id: interaction.user.id, username: interaction.user.username },
          memberRoles: [...member.roles.cache.keys()],
          guildId: interaction.guildId,
          threadId: interaction.channelId,
        },
      });
      const delivered = await badgeWork(client, secret).run({ client: interaction.client });
      if (Result.isError(delivered))
        throw new Error("Saved. I couldn’t post the next step yet; I’ll retry shortly.");
    } catch (cause) {
      const content = messageOf(cause).slice(0, 1900);
      if (interaction.deferred || interaction.replied)
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
    return true;
  };
}
