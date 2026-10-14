import { MAX_CUTTING_SHEETS, materialIdsSchema } from "@purduehackers/badges/contracts";
import type { BadgeMaterial } from "@purduehackers/badges/contracts";
import {
  getMaterial,
  MATERIAL_TYPE_CONFIGS,
  materialDescription,
} from "@purduehackers/badges/materials";
import { ComponentType, LabelBuilder, ModalBuilder, StringSelectMenuBuilder } from "discord.js";
import type { ModalSubmitFields } from "discord.js";

export function materialsModal(control: string, choices: BadgeMaterial[]): ModalBuilder {
  if (!choices.length)
    throw new Error("Acrylic is out of stock. Ask an organizer to update inventory.");
  const categories = [...new Set(choices.map((material) => getMaterial(material.materialId).type))];
  return new ModalBuilder()
    .setCustomId(control)
    .setTitle("Choose acrylic colors")
    .addLabelComponents(
      categories.map((type) => {
        const options = choices.filter(
          (material) => getMaterial(material.materialId).type === type,
        );
        return new LabelBuilder()
          .setLabel(MATERIAL_TYPE_CONFIGS[type].label)
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId(`colors:${type}`)
              .setPlaceholder("Choose one or more colors")
              .setRequired(categories.length === 1)
              .setMinValues(Number(categories.length === 1))
              .setMaxValues(Math.min(options.length, MAX_CUTTING_SHEETS))
              .addOptions(
                options.map((material) => ({
                  label: materialDescription(material),
                  value: material.materialId,
                })),
              ),
          );
      }),
    );
}

export function parseMaterials(submission: ModalSubmitFields): string[] {
  const values = [...submission.fields.values()].flatMap((field) => {
    if (field.type !== ComponentType.StringSelect || !field.customId.startsWith("colors:"))
      throw new Error("Reopen Choose acrylic to select your colors.");
    return field.values;
  });
  const selection = materialIdsSchema.safeParse(values);
  if (!selection.success)
    throw new Error(`Choose between 1 and ${MAX_CUTTING_SHEETS} acrylic colors.`);
  return selection.data;
}
