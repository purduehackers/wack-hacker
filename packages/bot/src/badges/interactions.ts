import { criterionSchema, settingsSchema } from "@repo/badges/contracts";
import { failureGuidance } from "@repo/badges/presentation";
import type { Action } from "@repo/badges/wire";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { Interaction, ModalSubmitInteraction } from "discord.js";
import { z } from "zod";

import type { BadgeClient } from "./client.ts";
import { badgeEmbed } from "./messages.ts";
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
class FormError extends Error {}

function formFailure(cause: unknown) {
  return badgeEmbed(
    cause instanceof FormError ? cause.message : failureGuidance(messageOf(cause)),
    "Let’s try that again",
  );
}

function input(name: string, label: string, value?: string, required = true) {
  const field = new TextInputBuilder()
    .setCustomId(name)
    .setStyle(name === "note" ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(name === "note" ? 1500 : 100);
  if (value) field.setValue(value);
  return new LabelBuilder().setLabel(label).setTextInputComponent(field);
}
function settingsModal(control: string) {
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Material and sizes")
    .addLabelComponents(
      input("material", "Badge material", "Acrylic"),
      input("sizes", "Badge size range (inches)", "2 to 2.7").setDescription(
        "Size of the longest side. I’ll find options within this range.",
      ),
      input("stamp", "Stamp size (inches)", "1.5").setDescription(
        "Size of the longest side, up to 1.5 inches.",
      ),
      new LabelBuilder().setLabel("Stamp direction").setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId("mirror")
          .setPlaceholder("Choose how to prepare the stamp")
          .addOptions(
            {
              label: "Mirror for stamping",
              value: "yes",
              description: "Flip the artwork so the stamped impression reads correctly.",
            },
            {
              label: "Keep as drawn",
              value: "no",
              description: "Use this if your artwork is already mirrored.",
            },
          ),
      ),
      input("gap", "Space between badges (mm)", "0.5").setDescription(
        "The cutting team can help if you’re unsure.",
      ),
    );
}
const reviewInstructions = {
  version:
    "Read the version on the full badge and close-ups. It should match the version above exactly, including any zeros at the end.",
  date: "Read the date on the full badge and close-ups. It should match the Hack Night date above.",
  physical:
    "Check the design at its chosen size. Engraved lines should be at least 3% of the badge’s size. Look for fragile connections and tiny details. Use strong contrast and two or three gray tones at most; use only black and white for a first badge. Pale details may disappear. Keep all artwork inside the red cutting outline.",
  stamp:
    "Compare the original and cutting preview. The center should be a simple symbol without lettering or intricate details; lettering around the border is fine. Use black and white, no larger than 1.5 inches. Check that the stamped impression will face the right way.",
};
function decisionModal(control: string, criterion: keyof typeof reviewInstructions) {
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle(`Check ${criterion === "physical" ? "physical design" : criterion}`)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(reviewInstructions[criterion]))
    .addLabelComponents(
      new LabelBuilder().setLabel("What do you think?").setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId("verdict")
          .setPlaceholder("Choose your feedback")
          .addOptions(
            {
              label: "Looks good",
              value: "approve",
              description: "I checked the full design and close-ups.",
            },
            {
              label: "Needs a change",
              value: "changes",
              description: "I’ll explain what to adjust.",
            },
            {
              label: "Hard to tell",
              value: "unclear",
              description: "I need a clearer view or another look.",
            },
          ),
      ),
      input("note", "Feedback for the designer", undefined, false).setDescription(
        "If something needs changing or is hard to see, leave a short note.",
      ),
    );
}
function modalAction(interaction: ModalSubmitInteraction, action: string): Action {
  const field = (name: string) => interaction.fields.getTextInputValue(name).trim();
  if (action === "settings") {
    const sizes = field("sizes").split(/\s*(?:to|[–—,-])\s*/iu);
    const parsedSizes = z.tuple([decimal, decimal]).safeParse(sizes);
    if (!parsedSizes.success)
      throw new FormError(
        "Enter a size range such as 2 to 2.7 inches, using just the two numbers.",
      );
    const [minSizeIn, maxSizeIn] = parsedSizes.data;
    const stampSize = decimal.safeParse(field("stamp"));
    const spacing = decimal.safeParse(field("gap"));
    if (!stampSize.success || !spacing.success)
      throw new FormError("Use numbers for the stamp size and spacing, such as 1.5 and 0.5.");
    const direction = z
      .enum(["yes", "no"])
      .safeParse(interaction.fields.getStringSelectValues("mirror")[0]);
    if (!direction.success)
      throw new FormError("Choose whether to mirror the stamp or keep it as drawn.");
    const settings = settingsSchema.safeParse({
      material: field("material"),
      minSizeIn,
      maxSizeIn,
      stampSizeIn: stampSize.data,
      mirrorStamp: direction.data === "yes",
      gapMm: spacing.data,
    });
    if (!settings.success)
      throw new FormError(
        "Use a badge range from 2 to 10 inches, a stamp no larger than 1.5 inches, and spacing from 0.2 to 5 mm. The larger badge size must come second.",
      );
    return {
      kind: "settings",
      value: settings.data,
    };
  }
  const verdict = z
    .enum(["approve", "changes", "unclear"])
    .safeParse(interaction.fields.getStringSelectValues("verdict")[0]);
  if (!verdict.success) throw new FormError("Choose the feedback that best matches what you see.");
  if (verdict.data !== "approve" && !field("note"))
    throw new FormError("Leave a short note about what to change or what is hard to see.");
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
        throw new FormError("Saved. I couldn’t post the next step yet; I’ll retry shortly.");
    } catch (cause) {
      const embeds = [formFailure(cause)];
      if (interaction.deferred || interaction.replied)
        await interaction.followUp({
          embeds,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      else
        await interaction.reply({
          embeds,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
    }
    return true;
  };
}
