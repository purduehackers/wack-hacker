import { MAX_CUTTING_SHEETS } from "@purduehackers/badges/contracts";
import { stockSelectionSchema } from "@purduehackers/badges/inventory-contracts";
import type { StockItem, StockSelection } from "@purduehackers/badges/inventory-contracts";
import {
  getMaterial,
  MATERIAL_TYPE_CONFIGS,
  thicknessLabel,
} from "@purduehackers/badges/materials";
import { ComponentType, LabelBuilder, ModalBuilder, StringSelectMenuBuilder } from "discord.js";
import type { ModalSubmitFields } from "discord.js";

export function materialsModal(control: string, stock: StockItem[]): ModalBuilder {
  const available = stock.filter((item) => item.quantity > item.reserved);
  const count = available.reduce((sum, item) => sum + item.quantity - item.reserved, 0);
  if (!count) throw new Error("Acrylic is out of stock. Ask an organizer to update inventory.");
  if (count > 25)
    throw new Error(
      "There are more sheets than Discord can show in one dropdown. Tell me the acrylic, size, and quantity you want in this thread.",
    );
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Choose acrylic")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Sheets in stock")
        .setDescription("Each option is one sheet. Select all the sheets you want to use.")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("stock-sheets")
            .setPlaceholder("Choose your sheets")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(Math.min(count, MAX_CUTTING_SHEETS))
            .addOptions(
              available.flatMap((item) => {
                const material = getMaterial(item.materialId);
                const quantity = item.quantity - item.reserved;
                return Array.from({ length: quantity }, (_, index) => ({
                  label: `${MATERIAL_TYPE_CONFIGS[material.type].label} ${material.name} Acrylic - ${item.widthIn}x${item.heightIn}in`,
                  description: `${thicknessLabel(item.thicknessMm)}${quantity > 1 ? ` · Sheet ${index + 1} of ${quantity}` : ""}`,
                  value: `${item.id}.${index}`,
                }));
              }),
            ),
        ),
    );
}

export function parseMaterials(submission: ModalSubmitFields): StockSelection {
  const fields = [...submission.fields.values()];
  const selectionField = fields[0];
  if (
    fields.length !== 1 ||
    selectionField?.type !== ComponentType.StringSelect ||
    selectionField.customId !== "stock-sheets"
  )
    throw new Error("Reopen Choose acrylic to select your sheets.");
  const quantities = new Map<string, number>();
  if (new Set(selectionField.values).size !== selectionField.values.length)
    throw new Error("Choose each sheet once.");
  for (const value of selectionField.values) {
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
