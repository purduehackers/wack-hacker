import { BadgeApiError } from "@purduehackers/badges/client";
import type { BadgeClient } from "@purduehackers/badges/client";
import {
  inventoryActionSchema,
  inventoryResponseSchema,
  stockLabel,
} from "@purduehackers/badges/inventory-contracts";
import type { InventoryAction, InventoryResponse } from "@purduehackers/badges/inventory-contracts";
import { STOCK_MATERIALS } from "@purduehackers/badges/materials";
import { designerText } from "@purduehackers/badges/presentation";
import { DISCORD_GUILD_ID, roleAtLeast, roleFromMemberRoles, UserRole } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type {
  APIEmbed,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";

import type { SlashCommand } from "../framework/commands.ts";

const inventoryCommands = {
  list: "See material and sheet counts",
  add: "Add sheets to inventory (organizers only)",
  use: "Record sheets you used (organizers only)",
  set: "Correct the number of sheets on hand (organizers only)",
  history: "See recent changes to a material count",
};

export const builder = new SlashCommandBuilder();
builder
  .setName("badge")
  .setDescription("Manage badge materials")
  .setContexts(InteractionContextType.Guild)
  .addSubcommandGroup((group) => {
    group.setName("inventory").setDescription("Track material on hand");
    for (const [name, description] of Object.entries(inventoryCommands))
      group.addSubcommand((sub) =>
        inventoryOptions(sub.setName(name).setDescription(description), name),
      );
    return group;
  });

function inventoryOptions(sub: SlashCommandSubcommandBuilder, name: string) {
  if (name === "list")
    return sub.addIntegerOption((option) =>
      option.setName("page").setDescription("Page to show").setMinValue(1),
    );
  const adding = name === "add";
  sub.addStringOption((option) =>
    option
      .setName(adding ? "material" : "item")
      .setDescription(
        adding ? "Acrylic color and finish, or stamp rubber" : "Material and sheet size",
      )
      .setAutocomplete(true)
      .setRequired(true),
  );
  if (name === "history") return sub;
  sub.addIntegerOption((option) =>
    option
      .setName("quantity")
      .setDescription("Number of whole sheets")
      .setMinValue(Number(name !== "set"))
      .setMaxValue(10_000)
      .setRequired(true),
  );
  if (adding)
    for (const dimension of ["width", "height", "thickness"]) {
      const thickness = dimension === "thickness";
      sub.addNumberOption((option) =>
        option
          .setName(dimension)
          .setDescription(
            thickness ? "Material thickness in millimeters" : `Sheet ${dimension} in inches`,
          )
          .setMinValue(thickness ? 0.1 : 0.25)
          .setMaxValue(thickness ? 100 : 120)
          .setRequired(true),
      );
    }
  return sub.addStringOption((option) =>
    option
      .setName("note")
      .setDescription("Optional note, such as the Hack Night or purchase")
      .setMaxLength(200),
  );
}

function actionFor(interaction: ChatInputCommandInteraction): InventoryAction {
  const kind = interaction.options.getSubcommand();
  const options = interaction.options;
  if (kind === "list")
    return inventoryActionSchema.parse({ kind, page: options.getInteger("page") ?? 1 });
  if (kind === "add")
    return inventoryActionSchema.parse({
      kind,
      materialId: options.getString("material", true),
      quantity: options.getInteger("quantity", true),
      widthIn: options.getNumber("width", true),
      heightIn: options.getNumber("height", true),
      thicknessMm: options.getNumber("thickness", true),
      note: options.getString("note") ?? "",
    });
  if (kind === "history")
    return inventoryActionSchema.parse({ kind, itemId: options.getString("item", true) });
  return inventoryActionSchema.parse({
    kind,
    itemId: options.getString("item", true),
    quantity: options.getInteger("quantity", true),
    note: options.getString("note") ?? "",
  });
}

export function inventoryEmbed(response: InventoryResponse, action: InventoryAction): APIEmbed {
  const embed: APIEmbed = { color: 0x5865f2, title: "Material inventory" };
  if (action.kind === "list") {
    embed.description = response.items.length
      ? "Publishing badge files deducts the selected acrylic sheets. Record other use here."
      : "No materials recorded. Add sheets with /badge inventory add.";
    embed.fields = response.items.map((item) => ({
      name: stockLabel(item),
      value: `${item.quantity} sheets${item.reserved ? ` · ${item.reserved} reserved for publication` : ""}`,
    }));
    embed.footer = { text: `Page ${response.page ?? 1} of ${response.pages ?? 1}` };
  } else if (action.kind === "history") {
    embed.title = "Material history";
    const dates = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/Indiana/Indianapolis",
    });
    embed.description = response.items[0]
      ? stockLabel(response.items[0])
      : "This material is no longer available.";
    embed.fields = (response.changes ?? []).map((change) => {
      let summary = `Counted ${change.after}`;
      if (change.operation === "add") summary = `Added ${change.after - change.before}`;
      if (["use", "publish"].includes(change.operation))
        summary = `Used ${change.before - change.after}`;
      return {
        name: `${dates.format(change.createdAt)} · ${change.username}`,
        value: `${summary} sheets. ${change.after} remain.${change.note ? `\n${designerText(change.note, "")}` : ""}`,
      };
    });
  } else {
    embed.title = "Count updated";
    if (action.kind === "add") embed.title = "Material added";
    if (action.kind === "use") embed.title = "Material use recorded";
    const item = response.items[0];
    embed.description = item ? stockLabel(item) : "Run /badge inventory list to check the count.";
    if (item) embed.fields = [{ name: "Sheets on hand", value: String(item.quantity) }];
  }
  return embed;
}

function requestFor(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  action: InventoryAction,
  memberRoles: string[],
) {
  return {
    guildId: interaction.guildId,
    actor: { id: interaction.user.id, username: interaction.user.username },
    canManufacture: roleAtLeast(roleFromMemberRoles(memberRoles), UserRole.Organizer),
    interactionId: interaction.id,
    action,
  };
}

async function suggestions(interaction: AutocompleteInteraction, api?: BadgeClient) {
  if (interaction.guildId !== DISCORD_GUILD_ID) return [];
  const focused = interaction.options.getFocused(true);
  if (focused.name === "material")
    return STOCK_MATERIALS.map((material) => ({
      name:
        material.id === "stamp-rubber"
          ? material.name
          : `${material.type} acrylic · ${material.name}`,
      value: material.id,
    }))
      .filter((material) => material.name.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);
  if (!api || focused.name !== "item") return [];
  const response = inventoryResponseSchema.parse(
    await api.post(
      "inventory",
      requestFor(interaction, { kind: "suggest", query: focused.value }, []),
      1600,
    ),
  );
  return response.items.map((item) => ({
    name: `${stockLabel(item)} · ${item.quantity} sheets`.slice(0, 100),
    value: item.id,
  }));
}

async function inventoryReply(
  interaction: ChatInputCommandInteraction,
  api?: BadgeClient,
): Promise<APIEmbed> {
  if (!api)
    return { title: "Material inventory", description: "Material inventory isn’t available yet." };
  if (interaction.guildId !== DISCORD_GUILD_ID || !interaction.guild)
    return {
      title: "Material inventory",
      description: "Use this command in the Purdue Hackers server.",
    };
  const parsed = Result.try({
    try: () => actionFor(interaction),
    catch: () => "Check the material, dimensions, and quantity.",
  });
  if (Result.isError(parsed)) return { title: "Check your entry", description: parsed.error };
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  try {
    const response = inventoryResponseSchema.parse(
      await api.post(
        "inventory",
        requestFor(interaction, parsed.value, [...member.roles.cache.keys()]),
      ),
    );
    return inventoryEmbed(response, parsed.value);
  } catch (cause) {
    if (!(cause instanceof BadgeApiError)) throw cause;
    return { title: "Material inventory", description: designerText(cause.message) };
  }
}

export function badgeCommand(api?: BadgeClient): SlashCommand {
  return {
    builder,
    execute: async (interaction) =>
      Result.tryPromise({
        try: async () => {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const embed = await inventoryReply(interaction, api);
          await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
        catch: (cause) => new Transient({ operation: "badge inventory", detail: messageOf(cause) }),
      }),
    autocomplete: async (interaction) =>
      Result.tryPromise({
        try: async () => {
          const options = await suggestions(interaction, api).catch(() => []);
          await interaction.respond(options);
        },
        catch: (cause) =>
          new Transient({ operation: "suggest badge materials", detail: messageOf(cause) }),
      }),
  };
}
