import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const badgeStock = sqliteTable(
  "badge_stock",
  {
    id: text("id").primaryKey(),
    materialId: text("material_id").notNull(),
    widthIn: real("width_in").notNull(),
    heightIn: real("height_in").notNull(),
    thicknessMm: real("thickness_mm").notNull(),
    quantity: integer("quantity").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [check("badge_stock_nonnegative", sql`${table.quantity} >= 0`)],
);

export const badgeStockChanges = sqliteTable(
  "badge_stock_changes",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    operation: text("operation").notNull(),
    before: integer("before").notNull(),
    after: integer("after").notNull(),
    actorId: text("actor_id").notNull(),
    username: text("username").notNull(),
    note: text("note").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("badge_stock_changes_item").on(table.itemId, table.createdAt)],
);

export const badgeStockPublications = sqliteTable("badge_stock_publications", {
  id: text("id").primaryKey(),
  plan: text("plan").notNull(),
  state: text("state").notNull(),
  commit: text("commit"),
  createdAt: integer("created_at").notNull(),
});
