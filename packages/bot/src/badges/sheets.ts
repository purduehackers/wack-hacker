import { MAX_CUTTING_SHEETS, sheetBatchSchema } from "@purduehackers/badges/contracts";
import type { Review } from "@purduehackers/badges/contracts";
import { sheetLabel } from "@purduehackers/badges/presentation";
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export function sheetsModal(control: string, review: Review): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("sheets")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500)
    .setPlaceholder("2 × 12 × 12");
  if (review.sheetBatch?.length)
    input.setValue(
      review.sheetBatch.map((sheet) => `${sheet.quantity} × ${sheetLabel(sheet)}`).join("\n"),
    );
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Choose cutting sheets")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Quantity × width × height, in inches")
        .setDescription(
          `One size per line. Use up to ${MAX_CUTTING_SHEETS} sheets of your selected acrylic.`,
        )
        .setTextInputComponent(input),
    );
}

export function parseSheets(text: string) {
  const sheets = text
    .trim()
    .split(/\n/u)
    .filter((line) => line.trim())
    .map((line) => {
      const match =
        /^\s*(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|[″"])?\s*$/iu.exec(
          line,
        );
      if (!match)
        throw new Error(
          "Enter sheets as quantity × width × height in inches, one size per line. For two 12 × 12 sheets, enter 2 × 12 × 12.",
        );
      return { quantity: Number(match[1]), widthIn: Number(match[2]), heightIn: Number(match[3]) };
    });
  const result = sheetBatchSchema.safeParse(sheets);
  if (!result.success)
    throw new Error(
      `Choose up to ${MAX_CUTTING_SHEETS} sheets, with positive quantities and dimensions from 0.25 to 120 inches.`,
    );
  return result.data;
}
