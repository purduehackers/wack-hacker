import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { carts } from "./carts.ts";

export const cartItems = sqliteTable(
  "cart_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    asin: text("asin").notNull(),
    title: text("title").notNull(),
    price: real("price").notNull(),
    quantity: integer("quantity").notNull(),
    addedAt: text("added_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [uniqueIndex("cart_items_cart_asin_uq").on(table.cartId, table.asin)],
);
