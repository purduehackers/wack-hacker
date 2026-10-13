import {
  inventoryActionSchema,
  inventoryResponseSchema,
  stockLabel,
} from "@repo/badges/inventory-contracts";
import type { InventoryAction, InventoryResponse } from "@repo/badges/inventory-contracts";
import { STOCK_MATERIALS } from "@repo/badges/materials";
import { designerText } from "@repo/badges/presentation";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import type {
  APIEmbed,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";

import { BadgeApiError } from "../badges/client.ts";
import type { BadgeClient } from "../badges/client.ts";
import type { SlashCommand } from "../framework/commands.ts";

function itemOption(sub: SlashCommandSubcommandBuilder) {
  return sub.addStringOption((option) =>
    option
      .setName("item")
      .setDescription("Material and sheet size")
      .setAutocomplete(true)
      .setRequired(true),
  );
}
function quantityOption(sub: SlashCommandSubcommandBuilder, minimum: number) {
  return sub.addIntegerOption((option) =>
    option
      .setName("quantity")
      .setDescription("Number of whole sheets")
      .setMinValue(minimum)
      .setMaxValue(10_000)
      .setRequired(true),
  );
}
function noteOption(sub: SlashCommandSubcommandBuilder) {
  return sub.addStringOption((option) =>
    option
      .setName("note")
      .setDescription("Optional note, such as the Hack Night or purchase")
      .setMaxLength(200),
  );
}

export const builder = new SlashCommandBuilder();
builder
  .setName("badge")
  .setDescription("Manage badge materials")
  .setContexts(InteractionContextType.Guild)
  .addSubcommandGroup((group) =>
    group
      .setName("inventory")
      .setDescription("Track material on hand")
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("See material and sheet counts")
          .addIntegerOption((option) =>
            option.setName("page").setDescription("Page to show").setMinValue(1),
          ),
      )
      .addSubcommand((sub) => {
        sub
          .setName("add")
          .setDescription("Add sheets to inventory (organizers only)")
          .addStringOption((option) =>
            option
              .setName("material")
              .setDescription("Acrylic color and finish, or stamp rubber")
              .setAutocomplete(true)
              .setRequired(true),
          );
        quantityOption(sub, 1);
        for (const name of ["width", "height"])
          sub.addNumberOption((option) =>
            option
              .setName(name)
              .setDescription(`Sheet ${name} in inches`)
              .setMinValue(0.25)
              .setMaxValue(120)
              .setRequired(true),
          );
        sub.addNumberOption((option) =>
          option
            .setName("thickness")
            .setDescription("Material thickness in millimeters")
            .setMinValue(0.1)
            .setMaxValue(100)
            .setRequired(true),
        );
        return noteOption(sub);
      })
      .addSubcommand((sub) =>
        noteOption(
          quantityOption(
            itemOption(
              sub.setName("use").setDescription("Record sheets you used (organizers only)"),
            ),
            1,
          ),
        ),
      )
      .addSubcommand((sub) =>
        noteOption(
          quantityOption(
            itemOption(
              sub
                .setName("set")
                .setDescription("Correct the number of sheets on hand (organizers only)"),
            ),
            0,
          ),
        ),
      )
      .addSubcommand((sub) =>
        itemOption(sub.setName("history").setDescription("See recent changes to a material count")),
      ),
  );

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
      ? "Whole sheets on hand. Record use after cutting."
      : "No materials recorded. Add sheets with /badge inventory add.";
    embed.fields = response.items.map((item) => ({
      name: stockLabel(item),
      value: `${item.quantity} sheets`,
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
    embed.fields = (response.changes ?? []).map((change) => ({
      name: `${dates.format(change.createdAt)} · ${change.username}`,
      value: `${change.operation === "add" ? `Added ${change.after - change.before}` : change.operation === "use" ? `Used ${change.before - change.after}` : `Counted ${change.after}`} sheets. ${change.after} remain.${change.note ? `\n${designerText(change.note, "")}` : ""}`,
    }));
  } else {
    embed.title =
      action.kind === "add"
        ? "Material added"
        : action.kind === "use"
          ? "Material use recorded"
          : "Count updated";
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
    memberRoles,
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

export function badgeCommand(api?: BadgeClient): SlashCommand {
  return {
    builder,
    execute: async (interaction) =>
      Result.tryPromise({
        try: async () => {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          let embed: APIEmbed;
          if (!api)
            embed = {
              title: "Material inventory",
              description: "Material inventory isn’t available yet.",
            };
          else if (interaction.guildId !== DISCORD_GUILD_ID || !interaction.guild)
            embed = {
              title: "Material inventory",
              description: "Use this command in the Purdue Hackers server.",
            };
          else {
            const parsed = Result.try({
              try: () => actionFor(interaction),
              catch: () => "Check the material, dimensions, and quantity.",
            });
            if (Result.isError(parsed))
              embed = { title: "Check your entry", description: parsed.error };
            else {
              const member = await interaction.guild.members.fetch({
                user: interaction.user.id,
                force: true,
              });
              try {
                const response = inventoryResponseSchema.parse(
                  await api.post(
                    "inventory",
                    requestFor(interaction, parsed.value, [...member.roles.cache.keys()]),
                  ),
                );
                embed = inventoryEmbed(response, parsed.value);
              } catch (cause) {
                if (!(cause instanceof BadgeApiError)) throw cause;
                embed = { title: "Material inventory", description: designerText(cause.message) };
              }
            }
          }
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
