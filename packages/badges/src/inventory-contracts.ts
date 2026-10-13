import { z } from "zod";

import { personSchema } from "./contracts.ts";
import { materialLabel, stockMaterial, thicknessLabel } from "./materials.ts";

export const materialIdSchema = z.string().refine((id) => stockMaterial(id) !== undefined, {
  message: "Choose a material from the suggestions.",
});
const quantity = z.int().min(0).max(10_000);
const dimension = z.number().min(0.25).max(120).multipleOf(0.001);
export const stockSpecSchema = z.strictObject({
  materialId: materialIdSchema,
  widthIn: dimension,
  heightIn: dimension,
  thicknessMm: z.number().min(0.1).max(100).multipleOf(0.001),
});
export const stockItemSchema = stockSpecSchema.extend({
  id: z.string().regex(/^[a-f0-9]{24}$/u),
  quantity,
  reserved: quantity.default(0),
  updatedAt: z.int().nonnegative(),
});
const note = z.string().trim().max(200).default("");
export const inventoryActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("list"), page: z.int().min(1).default(1) }),
  stockSpecSchema.extend({ kind: z.literal("add"), quantity: quantity.min(1), note }),
  z.strictObject({
    kind: z.literal("use"),
    itemId: stockItemSchema.shape.id,
    quantity: quantity.min(1),
    note,
  }),
  z.strictObject({ kind: z.literal("set"), itemId: stockItemSchema.shape.id, quantity, note }),
  z.strictObject({ kind: z.literal("history"), itemId: stockItemSchema.shape.id }),
  z.strictObject({ kind: z.literal("suggest"), query: z.string().trim().max(100) }),
]);
export const inventoryRequestSchema = z.strictObject({
  guildId: z.string(),
  actor: personSchema,
  memberRoles: z.array(z.string()).max(100),
  interactionId: z.string().regex(/^\d{17,20}$/u),
  action: inventoryActionSchema,
});
export const stockChangeSchema = z.strictObject({
  id: z.string(),
  itemId: stockItemSchema.shape.id,
  operation: z.enum(["add", "use", "set", "publish"]),
  before: quantity,
  after: quantity,
  actorId: z.string(),
  username: z.string(),
  note: z.string(),
  createdAt: z.int().nonnegative(),
});
export const inventoryResponseSchema = z.strictObject({
  items: z.array(stockItemSchema),
  page: z.int().positive().optional(),
  pages: z.int().positive().optional(),
  changes: z.array(stockChangeSchema).optional(),
});
export type StockItem = z.output<typeof stockItemSchema>;
export type StockSpec = z.output<typeof stockSpecSchema>;
export type InventoryAction = z.output<typeof inventoryActionSchema>;
export type InventoryRequest = z.output<typeof inventoryRequestSchema>;
export type InventoryResponse = z.output<typeof inventoryResponseSchema>;
export type StockChange = z.output<typeof stockChangeSchema>;

export function stockLabel(item: StockSpec): string {
  return `${materialLabel(item.materialId)} · ${item.widthIn} × ${item.heightIn} in · ${thicknessLabel(item.thicknessMm)}`;
}
