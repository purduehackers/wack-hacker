import { MAX_CUTTING_SHEETS } from "@purduehackers/badges/contracts";
import { stockLabel, stockSelectionSchema } from "@purduehackers/badges/inventory-contracts";
import type { StockItem, StockSelection } from "@purduehackers/badges/inventory-contracts";
import {
  getMaterial,
  MATERIAL_TYPE_CONFIGS,
  thicknessLabel,
} from "@purduehackers/badges/materials";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { APISelectMenuOption, Message } from "discord.js";

import { badgeEmbed } from "./messages.ts";

export function materialsModal(control: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Find acrylic")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Search inventory")
        .setDescription("Search by color or sheet size. Leave blank to browse.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("search")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100)
            .setPlaceholder("Blue 12x18"),
        ),
    );
}

// The ephemeral message holds the draft selection. Searching does not change the review.
export function materialOptions(message?: Pick<Message, "components">): APISelectMenuOption[] {
  return (
    message?.components
      .flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
      .filter((component) => component.type === ComponentType.StringSelect)
      .find((component) => component.customId.split(":")[3] === "material.select")?.options ?? []
  );
}

export function parseMaterials(selected: string[]): StockSelection {
  const quantities = new Map<string, number>();
  if (new Set(selected).size !== selected.length) throw new Error("Choose each sheet once.");
  for (const value of selected) {
    const [itemId] = value.split(".");
    if (!itemId || !/^[a-f0-9]{24}\.\d+$/u.test(value))
      throw new Error("Reopen Choose acrylic to select your sheets.");
    quantities.set(itemId, (quantities.get(itemId) ?? 0) + 1);
  }
  const selection = stockSelectionSchema.safeParse(
    [...quantities].map(([itemId, quantity]) => ({ itemId, quantity })),
  );
  if (!selection.success)
    throw new Error(`Choose between 1 and ${MAX_CUTTING_SHEETS} acrylic sheets.`);
  return selection.data;
}

function searchable(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(
      /(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)/gu,
      (_match, a, b) => `${Math.min(Number(a), Number(b))}x${Math.max(Number(a), Number(b))}`,
    )
    .replaceAll(/[^a-z0-9.]+/gu, " ")
    .trim();
}

function stockOptions(stock: StockItem[]): APISelectMenuOption[] {
  return stock.flatMap((item) => {
    const material = getMaterial(item.materialId);
    const quantity = Math.max(0, item.quantity - item.reserved);
    return Array.from({ length: Math.min(quantity, MAX_CUTTING_SHEETS) }, (_, index) => ({
      label: `${MATERIAL_TYPE_CONFIGS[material.type].label} ${material.name} Acrylic - ${item.widthIn}x${item.heightIn}in`,
      description: `${thicknessLabel(item.thicknessMm)}${quantity > 1 ? ` · Sheet ${index + 1} of ${quantity}` : ""}`,
      value: `${item.id}.${index}`,
    }));
  });
}

export function materialsPicker({
  stock,
  selected,
  search,
  control,
}: {
  stock: StockItem[];
  selected: string[];
  search: string | string[];
  control: (action: string) => string;
}) {
  const available = stockOptions(stock);
  const selection = selected.length ? parseMaterials(selected) : [];
  if (selected.some((value) => !available.some((option) => option.value === value)))
    throw new Error("Some selected sheets are no longer available. Reopen Choose acrylic.");
  const matches = Array.isArray(search)
    ? available.filter((option) => search.includes(option.value))
    : available.filter((option) => {
        const text = searchable(`${option.label} ${option.description}`);
        return searchable(search)
          .split(/\s+/u)
          .every((term) => text.includes(term));
      });
  const choices = [
    ...available.filter((option) => selected.includes(option.value)),
    ...matches.filter((option) => !selected.includes(option.value)),
  ];
  const embed = badgeEmbed(
    matches.length
      ? "Select your sheets, then continue. Search again to add another color or size."
      : "No sheets match your search. Try another color or sheet size.",
    "Choose acrylic",
    "warning",
  );
  if (selection.length)
    embed.fields = [
      {
        name: "Selected sheets",
        value: selection
          .map(({ itemId, quantity }) => {
            const item = stock.find((candidate) => candidate.id === itemId);
            if (!item) throw new Error("Reopen Choose acrylic to see current stock.");
            return `${quantity} × ${stockLabel(item)}`;
          })
          .join("\n"),
      },
    ];
  embed.footer = {
    text:
      choices.length > 25
        ? "Showing the first 25 sheets. Search by color and size to narrow the list."
        : `Each option is one sheet. Choose up to ${MAX_CUTTING_SHEETS}.`,
  };
  const components: (
    | ActionRowBuilder<StringSelectMenuBuilder>
    | ActionRowBuilder<ButtonBuilder>
  )[] = [];
  if (choices.length)
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(control("material.select"))
          .setPlaceholder("Choose your sheets")
          .setMinValues(0)
          .setMaxValues(Math.min(choices.length, MAX_CUTTING_SHEETS))
          .addOptions(
            choices
              .slice(0, 25)
              .map((entry) => ({ ...entry, default: selected.includes(entry.value) })),
          ),
      ),
    );
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(control("material.search"))
        .setLabel("Search again")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(control("material.use"))
        .setLabel(
          selected.length
            ? `Use ${selected.length} ${selected.length === 1 ? "sheet" : "sheets"}`
            : "Use selected sheets",
        )
        .setDisabled(!selected.length)
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
