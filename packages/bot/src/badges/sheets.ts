import {
  MAX_CUTTING_SHEETS,
  reviewMaterials,
  sheetBatchSchema,
} from "@purduehackers/badges/contracts";
import type { Review } from "@purduehackers/badges/contracts";
import type { StockItem } from "@purduehackers/badges/inventory-contracts";
import {
  getMaterial,
  MATERIAL_TYPE_CONFIGS,
  thicknessLabel,
} from "@purduehackers/badges/materials";
import { sheetKey, sheetLabel } from "@purduehackers/badges/presentation";
import {
  ComponentType,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { ModalSubmitFields } from "discord.js";

export const SHEETS_PER_MODAL = 5;
export function sheetsModal(control: string, review: Review, stock: StockItem[]): ModalBuilder {
  if (!stock.length)
    throw new Error("This acrylic is out of stock. Ask an organizer to update inventory.");
  if (stock.length > SHEETS_PER_MODAL) throw new Error("Choose a group of sheets first.");
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Choose cutting sheets")
    .addLabelComponents(
      stock.map((sheet) => {
        const label = sheetLabel(sheet);
        const material = getMaterial(sheet.materialId);
        const remaining = Math.max(0, sheet.quantity - sheet.reserved);
        const available = Math.min(remaining, MAX_CUTTING_SHEETS);
        const selected =
          review.sheetBatch?.find(
            (item) =>
              sheetKey({ ...item, material: item.material ?? reviewMaterials(review)[0] }) ===
              sheetKey({ ...sheet, material: sheet }),
          )?.quantity ?? 0;
        return new LabelBuilder()
          .setLabel(`${material.name} · ${label} in`)
          .setDescription(
            `${MATERIAL_TYPE_CONFIGS[material.type].label} · ${thicknessLabel(sheet.thicknessMm)} · ${Math.max(0, sheet.quantity - sheet.reserved)} available. Enter 0 to skip.`,
          )
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(`sheet:${sheet.id}`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(2)
              .setValue(String(Math.min(selected, available))),
          );
      }),
    );
}

export function parseSheets(submission: ModalSubmitFields, review: Review, stock: StockItem[]) {
  const sheets = submission.fields.map((field) => {
    const item = stock.find((sheet) => field.customId === `sheet:${sheet.id}`);
    if (!item || field.type !== ComponentType.TextInput)
      throw new Error("Reopen Change sheets to choose your sheet quantities.");
    const value = field.value.trim();
    if (!/^\d+$/u.test(value) || Number(value) > MAX_CUTTING_SHEETS)
      throw new Error(`Enter a whole number from 0 to ${MAX_CUTTING_SHEETS} for each size.`);
    return {
      widthIn: item.widthIn,
      heightIn: item.heightIn,
      material: { materialId: item.materialId, thicknessMm: item.thicknessMm },
      quantity: Number(value),
    };
  });
  // A paged modal changes only the stock items shown on that page.
  const retained = (review.sheetBatch ?? []).filter(
    (item) =>
      !sheets.some(
        (sheet) =>
          sheetKey(sheet) ===
          sheetKey({ ...item, material: item.material ?? reviewMaterials(review)[0] }),
      ),
  );
  const batch = [...retained, ...sheets.filter((entry) => entry.quantity > 0)];
  if (!batch.length) throw new Error("Choose at least one sheet.");
  const result = sheetBatchSchema.safeParse(batch);
  if (!result.success) throw new Error(`Choose up to ${MAX_CUTTING_SHEETS} sheets in total.`);
  return result.data;
}
