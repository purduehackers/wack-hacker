import { relations } from "drizzle-orm";

import { shoppingCartItems } from "./shopping-cart-items.ts";
import { shoppingCarts } from "./shopping-carts.ts";

export const shoppingCartsRelations = relations(shoppingCarts, ({ many }) => ({
  items: many(shoppingCartItems),
}));

export const shoppingCartItemsRelations = relations(shoppingCartItems, ({ one }) => ({
  cart: one(shoppingCarts, {
    fields: [shoppingCartItems.cartId],
    references: [shoppingCarts.id],
  }),
}));
