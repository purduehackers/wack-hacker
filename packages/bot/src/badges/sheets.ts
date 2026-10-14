import { MAX_CUTTING_SHEETS, sheetBatchSchema } from "@purduehackers/badges/contracts";
import type { Review } from "@purduehackers/badges/contracts";
import type { StockItem } from "@purduehackers/badges/inventory-contracts";
import { sheetLabel } from "@purduehackers/badges/presentation";
import {
  ComponentType,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { ModalSubmitFields } from "discord.js";

export function sheetsModal(control: string, review: Review, stock: StockItem[]): ModalBuilder {
  if (!stock.length)
    throw new Error("This acrylic is out of stock. Ask an organizer to update inventory.");
  if (stock.length > 5)
    throw new Error("Tell me the sheet sizes and quantities you want to use in this thread.");
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Choose cutting sheets")
    .addLabelComponents(
      stock.map((sheet) => {
        const label = sheetLabel(sheet);
        const available = Math.min(sheet.quantity - sheet.reserved, MAX_CUTTING_SHEETS);
        const selected =
          review.sheetBatch?.find((item) => sheetLabel(item) === label)?.quantity ?? 0;
        return new LabelBuilder()
          .setLabel(`${label} in — quantity`)
          .setDescription(
            `${sheet.quantity - sheet.reserved} available. Enter 0 to skip this size.`,
          )
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(`sheet:${sheet.widthIn}:${sheet.heightIn}`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(2)
              .setValue(String(Math.min(selected, available))),
          );
      }),
    );
}

export function parseSheets(submission: ModalSubmitFields) {
  const sheets = submission.fields
    .map((field) => {
      const match = /^sheet:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(field.customId);
      if (!match || field.type !== ComponentType.TextInput)
        throw new Error("Reopen Change sheets to choose your sheet quantities.");
      const value = field.value.trim();
      if (!/^\d+$/u.test(value) || Number(value) > MAX_CUTTING_SHEETS)
        throw new Error(`Enter a whole number from 0 to ${MAX_CUTTING_SHEETS} for each size.`);
      return { widthIn: Number(match[1]), heightIn: Number(match[2]), quantity: Number(value) };
    })
    .filter((entry) => entry.quantity > 0);
  if (!sheets.length) throw new Error("Choose at least one sheet.");
  const result = sheetBatchSchema.safeParse(sheets);
  if (!result.success) throw new Error(`Choose up to ${MAX_CUTTING_SHEETS} sheets in total.`);
  return result.data;
}
