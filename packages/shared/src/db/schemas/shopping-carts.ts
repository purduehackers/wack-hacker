import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The team's shared shopping cart. A single row, `id = "global"` — there is one
 * cart for the whole organization, not one per user.
 */
export const shoppingCarts = sqliteTable("shopping_carts", {
  id: text("id").primaryKey(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
