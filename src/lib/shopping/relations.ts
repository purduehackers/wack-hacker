import { relations } from "drizzle-orm";

import { cartItems } from "./schemas/cart-items.ts";
import { carts } from "./schemas/carts.ts";

export const cartsRelations = relations(carts, ({ many }) => ({
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, {
    fields: [cartItems.cartId],
    references: [carts.id],
  }),
}));
