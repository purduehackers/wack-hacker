import { BadgeApiError } from "@purduehackers/badges/client";
import type { BadgeClient } from "@purduehackers/badges/client";
import { BADGES_CHANNEL_ID, MAX_BADGE_COUNT, reviewSchema } from "@purduehackers/badges/contracts";
import { stockItemSchema } from "@purduehackers/badges/inventory-contracts";
import { failureGuidance } from "@purduehackers/badges/presentation";
import { actionName, actionSchema, componentId } from "@purduehackers/badges/wire";
import { bearerMatches } from "@repo/shared/bearer";
import { DISCORD_GUILD_ID, roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { messageOf } from "@repo/shared/errors";
import { ComponentType, MessageFlags } from "discord.js";
import type {
  ButtonInteraction,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  InteractionReplyOptions,
} from "discord.js";
import { z } from "zod";

import { button, link, row, textModal } from "./components.ts";
import { materialOptions, materialsModal, materialsPicker, parseMaterials } from "./materials.ts";
import { badgeEmbed } from "./messages.ts";
import { runBadgeWork, withBadgeTyping } from "./schedule.ts";
import { parseSheets, SHEETS_PER_MODAL, sheetsModal } from "./sheets.ts";

type BadgeInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
const controlSchema = z.tuple([
  z.literal("badge"),
  z.uuid(),
  z.string().regex(/^\d+$/u),
  z.string(),
  z.string(),
]);

const controlResponse = z.object({
  review: reviewSchema,
  availableSheets: z.array(stockItemSchema).default([]),
});
function commandFor(interaction: BadgeInteraction, name: string) {
  const [kind, role] = name.split(".");
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
    return {
      kind,
      ...(value && value !== "custom" ? { count: Number(value) } : {}),
    };
  }
  if (kind === "upload") {
    const attachment = interaction.isModalSubmit()
      ? interaction.fields.getUploadedFiles("design", true).first()
      : undefined;
    return {
      kind,
      role,
      ...(attachment
        ? { file: { url: attachment.url, filename: attachment.name, size: attachment.size } }
        : {}),
    };
  }
  if (kind === "roles") return { kind, badge: Number(role) };
  if (kind === "replace") return { kind, role };
  if (kind === "event" && interaction.isStringSelectMenu())
    return { kind, id: interaction.values[0] };
  return { kind };
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
  const action = actionSchema.parse(commandFor(interaction, name));
  return {
    id,
    version: Number(version),
    control: componentId(id, Number(version), actionName(action), secret),
    action,
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
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deadline.reject(new Error("The review check timed out. Try again.")),
    2300,
  );
  try {
    return await Promise.race([
      requestFor(interaction, secret).then(async (input) => ({
        ...input,
        ...controlResponse.parse(await api.post("control", input, 1800)),
      })),
      deadline.promise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function privateFailure(interaction: BadgeInteraction, cause: unknown) {
  const detail = messageOf(cause);
  const stale = /newer step|latest review|stale/iu.test(detail);
  const url = stale && cause instanceof BadgeApiError ? cause.url : undefined;
  const title = stale ? "There’s a newer step below" : "Continue with your designs";
  const options = {
    embeds: [badgeEmbed(failureGuidance(detail), title, stale ? "warning" : "error")],
    components: url ? [row(link("Go to latest step", url))] : [],
    allowedMentions: { parse: [] },
  };
  if (interaction.deferred && !interaction.replied && interaction.ephemeral)
    await interaction.editReply(options);
  else if (interaction.deferred || interaction.replied)
    await interaction.followUp({ ...options, flags: MessageFlags.Ephemeral });
  else await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
}
function sheetPages(
  id: string,
  version: number,
  stockCount: number,
  secret: string,
): InteractionReplyOptions {
  const buttons = Array.from({ length: Math.ceil(stockCount / SHEETS_PER_MODAL) }, (_, page) =>
    button(
      `Sheets ${page * SHEETS_PER_MODAL + 1}–${Math.min((page + 1) * SHEETS_PER_MODAL, stockCount)}`,
      componentId(id, version, `sheets.${page}`, secret),
    ),
  );
  if (buttons.length > 25)
    throw new Error("Tell me the sheet colors, sizes, and quantities you want in this thread.");
  return {
    embeds: [
      badgeEmbed(
        "Choose a group to edit its quantities. Your other sheets stay selected.",
        "Choose cutting sheets",
        "warning",
      ),
    ],
    components: Array.from({ length: Math.ceil(buttons.length / 5) }, (_, page) =>
      row(...buttons.slice(page * 5, (page + 1) * 5)),
    ),
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
    await interaction.showModal({
      custom_id: input.control,
      title: `Upload your ${input.action.role}`,
      components: [
        {
          type: ComponentType.Label,
          label: `${input.action.role === "badge" ? "Badge" : "Stamp"} SVG`,
          description: "Upload one SVG.",
          component: {
            type: ComponentType.FileUpload,
            custom_id: "design",
            required: true,
            min_values: 1,
            max_values: 1,
          },
        },
      ],
    });
  if (input.action.kind === "material")
    await interaction.showModal(
      materialsModal(componentId(input.id, input.version, "material.search", secret)),
    );
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
      textModal(input.control, "How many badges?", [
        {
          label: "Target quantity",
          description: `Enter a whole number from 1 to ${MAX_BADGE_COUNT}.`,
          input: { custom_id: "count", required: true, max_length: 3, placeholder: "120" },
        },
      ]),
    );
}

async function handleBadgeAction(
  interaction: BadgeInteraction,
  api: BadgeClient,
  secret: string,
  name: string,
) {
  if (interaction.isModalSubmit() && !interaction.isFromMessage())
    throw new Error("Use the latest review card.");
  const choosingMaterial =
    (name === "material.search" && interaction.isModalSubmit()) ||
    (name === "material.select" && interaction.isStringSelectMenu());
  const listed = choosingMaterial ? materialOptions(interaction.message ?? undefined) : [];
  // Search opens a private picker; later selections update that same message.
  if (
    choosingMaterial &&
    interaction.isModalSubmit() &&
    !interaction.message?.flags.has(MessageFlags.Ephemeral)
  )
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferUpdate();
  const input = await requestFor(interaction, secret);
  if (choosingMaterial) {
    const { availableSheets } = z
      .object({ availableSheets: z.array(stockItemSchema) })
      .parse(await api.post("control", input));
    const selected = interaction.isStringSelectMenu()
      ? interaction.values
      : listed.filter((option) => option.default).map((option) => option.value);
    if (selected.some((value) => !listed.some((option) => option.value === value)))
      throw new Error("Choose sheets from the dropdown.");
    await interaction.editReply(
      materialsPicker({
        stock: availableSheets,
        selected,
        search: interaction.isModalSubmit()
          ? interaction.fields.getTextInputValue("search").trim()
          : listed.map((choice) => choice.value),
        control: (action) => componentId(input.id, input.version, action, secret),
      }),
    );
    return;
  }
  if (name === "material.use" && interaction.isButton())
    input.action = {
      kind: "material",
      items: parseMaterials(
        materialOptions(interaction.message)
          .filter((option) => option.default)
          .map((option) => option.value),
      ),
    };
  if (input.action.kind === "sheets" && interaction.isModalSubmit()) {
    const current = controlResponse.parse(await api.post("control", input));
    input.action = {
      kind: "sheets",
      sheets: parseSheets(interaction.fields, current.review, current.availableSheets),
    };
  }
  await withBadgeTyping(interaction.channel?.isThread() ? interaction.channel : undefined, () =>
    api.post("action", input, 60_000),
  );
  if (name === "material.use")
    await interaction
      .deleteReply()
      .catch((cause) => console.error("Could not dismiss acrylic picker:", messageOf(cause)));
  await runBadgeWork(api, secret, interaction.client, interaction.channelId ?? undefined);
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
      if (
        interaction.isButton() &&
        (name.startsWith("upload.") ||
          name === "quantity.custom" ||
          name === "material" ||
          name === "material.search" ||
          name === "sheets" ||
          name.startsWith("sheets."))
      ) {
        await openBadgeModal(interaction, api, secret, name);
        return true;
      }
      await handleBadgeAction(interaction, api, secret, name);
    } catch (cause) {
      await privateFailure(interaction, cause);
    }
    return true;
  };
}
