import { BADGES_CHANNEL_ID, reviewSchema } from "@repo/badges/contracts";
import { failureGuidance } from "@repo/badges/presentation";
import { actionSchema, componentId } from "@repo/badges/wire";
import type { Action } from "@repo/badges/wire";
import { bearerMatches } from "@repo/shared/bearer";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
} from "discord.js";
import type {
  ButtonInteraction,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  InteractionReplyOptions,
} from "discord.js";
import { z } from "zod";

import { BadgeApiError } from "./client.ts";
import type { BadgeClient } from "./client.ts";
import { badgeEmbed } from "./messages.ts";
import { runBadgeWork, withBadgeTyping } from "./schedule.ts";
import { actionResult, settledCard } from "./status.ts";

type BadgeInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
const controlSchema = z.tuple([
  z.literal("badge"),
  z.uuid(),
  z.string().regex(/^\d+$/u),
  z.string(),
  z.string(),
]);

export function uploadModal(control: string, role: "badge" | "stamp") {
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle(`Upload your ${role}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`${role === "badge" ? "Badge" : "Stamp"} SVG`)
        .setDescription("Upload one SVG, up to 1 MB.")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("design")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1),
        ),
    );
}
function commandFor(interaction: BadgeInteraction, name: string): Action {
  const [kind, role, verdict] = name.split(".");
  if (kind === "review")
    return actionSchema.parse({
      kind: "decision",
      criterion: role,
      verdict,
      note: "",
    });
  if (kind === "upload") {
    const attachment = interaction.isModalSubmit()
      ? interaction.fields.getUploadedFiles("design", true).first()
      : undefined;
    return actionSchema.parse({
      kind: "upload",
      role,
      ...(attachment
        ? { file: { url: attachment.url, filename: attachment.name, size: attachment.size } }
        : {}),
    });
  }
  if (kind === "roles") return actionSchema.parse({ kind, badge: Number(role) });
  if (kind === "replace") return actionSchema.parse({ kind, role });
  if ((kind === "event" || kind === "material") && interaction.isStringSelectMenu())
    return actionSchema.parse({ kind, id: interaction.values[0] });
  return actionSchema.parse({ kind });
}
async function requestFor(interaction: BadgeInteraction, secret: string) {
  const [, id, version, name] = controlSchema.parse(interaction.customId.split(":"));
  if (
    !bearerMatches(`Bearer ${interaction.customId}`, componentId(id, Number(version), name, secret))
  )
    throw new Error("Invalid review control.");
  if (
    !interaction.guild ||
    interaction.guildId !== DISCORD_GUILD_ID ||
    !interaction.channel?.isThread() ||
    interaction.channel.parentId !== BADGES_CHANNEL_ID
  )
    throw new Error("This control belongs to a different review thread.");
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  // Older change buttons open the same upload as the current revision buttons.
  const actionName = name.endsWith(".changes")
    ? `upload.${name.split(".")[1]}`
    : name.startsWith("material.")
      ? "material"
      : name;
  return {
    id,
    version: Number(version),
    control: componentId(id, Number(version), actionName, secret),
    action: commandFor(interaction, actionName),
    eventId: interaction.id,
    actor: {
      person: { id: interaction.user.id, username: interaction.user.username },
      memberRoles: [...member.roles.cache.keys()],
      guildId: interaction.guildId,
      threadId: interaction.channel.id,
    },
  };
}
async function beforeModal(interaction: BadgeInteraction, api: BadgeClient, secret: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const input = await requestFor(interaction, secret);
        await api.post("control", input, 1800);
        return input;
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("The review check timed out. Try again.")),
          2300,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
async function privateFailure(interaction: BadgeInteraction, cause: unknown) {
  const detail = messageOf(cause),
    stale = /newer step|latest review|stale/iu.test(detail);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (stale) {
    const url = cause instanceof BadgeApiError ? cause.url : undefined;
    if (url)
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Go to latest step").setURL(url),
        ),
      );
  }
  const title = stale ? "There’s a newer step below" : "Continue with your designs";
  const options: InteractionReplyOptions = {
    embeds: [badgeEmbed(failureGuidance(detail), title, stale ? "warning" : "error")],
    components,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
  if (interaction.deferred || interaction.replied) await interaction.followUp(options);
  else await interaction.reply(options);
}
export function createBadgeInteractionHandler(api: BadgeClient, secret: string) {
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
      const name = controlSchema.parse(interaction.customId.split(":"))[3];
      const opensModal =
        interaction.isButton() && (name.startsWith("upload.") || name.endsWith(".changes"));
      if (opensModal && interaction.isButton()) {
        const input = await beforeModal(interaction, api, secret);
        if (input.action.kind === "upload")
          await interaction.showModal(uploadModal(input.control, input.action.role));
        return true;
      }
      // Acknowledge first. Only accepted actions settle the card; opening a modal does not.
      if (interaction.isModalSubmit() && !interaction.isFromMessage())
        throw new Error("Use the latest review card.");
      await interaction.deferUpdate();
      const input = await requestFor(interaction, secret);
      const response = await withBadgeTyping(
        interaction.channel?.isThread() ? interaction.channel : undefined,
        () => api.post("action", input, 60_000),
      );
      const { review } = z.object({ review: reviewSchema }).parse(response);
      if (interaction.message)
        await interaction.message
          .edit(settledCard(interaction.message, actionResult(input.action, review)))
          .catch((cause) =>
            console.error("Badge status will retry on delivery:", messageOf(cause)),
          );
      await runBadgeWork(api, secret, interaction.client, interaction.channelId ?? undefined);
    } catch (cause) {
      await privateFailure(interaction, cause);
    }
    return true;
  };
}
