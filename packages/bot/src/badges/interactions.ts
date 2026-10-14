import { BadgeApiError } from "@purduehackers/badges/client";
import type { BadgeClient } from "@purduehackers/badges/client";
import {
  BADGES_CHANNEL_ID,
  MAX_BADGE_COUNT,
  badgeMaterialSchema,
  reviewSchema,
} from "@purduehackers/badges/contracts";
import { stockItemSchema } from "@purduehackers/badges/inventory-contracts";
import { failureGuidance } from "@purduehackers/badges/presentation";
import { actionSchema, componentId } from "@purduehackers/badges/wire";
import type { Action } from "@purduehackers/badges/wire";
import { bearerMatches } from "@repo/shared/bearer";
import { DISCORD_GUILD_ID, roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type {
  ButtonInteraction,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  InteractionReplyOptions,
} from "discord.js";
import { z } from "zod";

import { materialsModal, parseMaterials } from "./materials.ts";
import { badgeEmbed } from "./messages.ts";
import { runBadgeWork, withBadgeTyping } from "./schedule.ts";
import { parseSheets, SHEETS_PER_MODAL, sheetsModal } from "./sheets.ts";
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
function materialAction(interaction: BadgeInteraction): Action {
  return {
    kind: "material",
    ...(interaction.isModalSubmit()
      ? { ids: parseMaterials(interaction.fields) }
      : interaction.isStringSelectMenu()
        ? { ids: interaction.values }
        : {}),
  };
}
function commandFor(interaction: BadgeInteraction, name: string): Action {
  const [kind, role] = name.split(".");
  if (kind === "sheets") return { kind };
  if (kind === "material") return materialAction(interaction);
  if (kind === "quantity") {
    const value = interaction.isModalSubmit()
      ? interaction.fields.getTextInputValue("count").trim()
      : role;
    if (
      value &&
      value !== "custom" &&
      (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > MAX_BADGE_COUNT)
    )
      throw new Error(`Enter a whole number from 1 to ${MAX_BADGE_COUNT}.`);
    return actionSchema.parse({
      kind,
      ...(value && value !== "custom" ? { count: Number(value) } : {}),
    });
  }
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
  if (kind === "event" && interaction.isStringSelectMenu())
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
  const actionName =
    name.startsWith("material.") || name.startsWith("quantity.") || name.startsWith("sheets.")
      ? (name.split(".")[0] ?? name)
      : name;
  return {
    id,
    version: Number(version),
    control: componentId(id, Number(version), actionName, secret),
    action: commandFor(interaction, name.startsWith("quantity.") ? name : actionName),
    eventId: interaction.id,
    actor: {
      person: { id: interaction.user.id, username: interaction.user.username },
      canManufacture: roleAtLeast(
        roleFromMemberRoles([...member.roles.cache.keys()]),
        UserRole.Organizer,
      ),
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
        const { review, availableSheets, materials } = z
          .object({
            review: reviewSchema,
            availableSheets: z.array(stockItemSchema).default([]),
            materials: z.array(badgeMaterialSchema).default([]),
          })
          .parse(await api.post("control", input, 1800));
        return { ...input, review, availableSheets, materials };
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
function sheetPages(
  id: string,
  version: number,
  stockCount: number,
  secret: string,
): InteractionReplyOptions {
  const buttons = Array.from({ length: Math.ceil(stockCount / SHEETS_PER_MODAL) }, (_, page) =>
    new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(componentId(id, version, `sheets.${page}`, secret))
      .setLabel(
        `Sheets ${page * SHEETS_PER_MODAL + 1}–${Math.min((page + 1) * SHEETS_PER_MODAL, stockCount)}`,
      ),
  );
  if (buttons.length > 25)
    throw new Error("Tell me the sheet colors, sizes, and quantities you want in this thread.");
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5)
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  return {
    embeds: [
      badgeEmbed(
        "Choose a group to edit its quantities. Your other sheets stay selected.",
        "Choose cutting sheets",
        "warning",
      ),
    ],
    components: rows,
    flags: MessageFlags.Ephemeral,
  };
}
async function openBadgeModal(
  interaction: ButtonInteraction,
  api: BadgeClient,
  secret: string,
  name: string,
): Promise<void> {
  const input = await beforeModal(interaction, api, secret);
  if (input.action.kind === "upload")
    await interaction.showModal(uploadModal(input.control, input.action.role));
  if (input.action.kind === "material")
    await interaction.showModal(materialsModal(input.control, input.materials));
  if (input.action.kind === "sheets") {
    if (name === "sheets" && input.availableSheets.length > SHEETS_PER_MODAL) {
      await interaction.reply(
        sheetPages(input.id, input.version, input.availableSheets.length, secret),
      );
      return;
    }
    const page = Number(name.split(".")[1] ?? 0);
    await interaction.showModal(
      sheetsModal(
        input.control,
        input.review,
        input.availableSheets.slice(page * SHEETS_PER_MODAL, (page + 1) * SHEETS_PER_MODAL),
      ),
    );
  }
  if (input.action.kind === "quantity")
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(input.control)
        .setTitle("How many badges?")
        .addLabelComponents(
          new LabelBuilder()
            .setLabel("Target quantity")
            .setDescription(`Enter a whole number from 1 to ${MAX_BADGE_COUNT}.`)
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId("count")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(3)
                .setPlaceholder("120"),
            ),
        ),
    );
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
        interaction.isButton() &&
        (name.startsWith("upload.") ||
          name === "quantity.custom" ||
          name === "material" ||
          name === "sheets" ||
          name.startsWith("sheets."));
      if (opensModal && interaction.isButton()) {
        await openBadgeModal(interaction, api, secret, name);
        return true;
      }
      // Acknowledge first. Only accepted actions settle the card; opening a modal does not.
      if (interaction.isModalSubmit() && !interaction.isFromMessage())
        throw new Error("Use the latest review card.");
      await interaction.deferUpdate();
      const input = await requestFor(interaction, secret);
      if (input.action.kind === "sheets" && interaction.isModalSubmit()) {
        const current = z
          .object({ review: reviewSchema, availableSheets: z.array(stockItemSchema) })
          .parse(await api.post("control", input));
        input.action = {
          kind: "sheets",
          sheets: parseSheets(interaction.fields, current.review, current.availableSheets),
        };
      }
      const response = await withBadgeTyping(
        interaction.channel?.isThread() ? interaction.channel : undefined,
        () => api.post("action", input, 60_000),
      );
      const { review } = z.object({ review: reviewSchema }).parse(response);
      const result = actionResult(input.action, review);
      if (interaction.message && result)
        await interaction.message
          .edit(settledCard(interaction.message, result))
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
