import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { shoppingCarts } from "./shopping-carts.ts";

/**
 * Line items in the shared cart.
 *
 * The unique index on `(cart_id, asin)` is what lets "add this again" be an
 * upsert that increments `quantity` rather than a duplicate row. The shopping
 * tools rely on that behaviour.
 */
export const shoppingCartItems = sqliteTable(
  "shopping_cart_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cartId: text("cart_id")
      .notNull()
      .references(() => shoppingCarts.id, { onDelete: "cascade" }),
    asin: text("asin").notNull(),
    title: text("title").notNull(),
    price: real("price").notNull(),
    quantity: integer("quantity").notNull(),
    addedAt: text("added_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [uniqueIndex("shopping_cart_items_cart_asin_uq").on(table.cartId, table.asin)],
);
