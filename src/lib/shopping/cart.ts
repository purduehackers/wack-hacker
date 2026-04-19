import { and, eq, sql } from "drizzle-orm";

import type { CartMutation, CartSnapshot, NewCartItemInput } from "./types.ts";

import { getDb } from "../db/index.ts";
import { shoppingCartItems } from "../db/schemas/shopping-cart-items.ts";
import { shoppingCarts } from "../db/schemas/shopping-carts.ts";

const GLOBAL_CART_ID = "global";

const NOW = sql`CURRENT_TIMESTAMP`;

export async function getCart(): Promise<CartSnapshot> {
  const db = getDb();
  const [cart] = await db
    .select({ updatedAt: shoppingCarts.updatedAt })
    .from(shoppingCarts)
    .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
  const items = await db
    .select()
    .from(shoppingCartItems)
    .where(eq(shoppingCartItems.cartId, GLOBAL_CART_ID))
    .orderBy(shoppingCartItems.addedAt);
  return { items, updatedAt: cart?.updatedAt ?? null };
}

export async function addCartItem(input: NewCartItemInput): Promise<CartMutation> {
  return getDb().transaction(async (tx) => {
    await tx.insert(shoppingCarts).values({ id: GLOBAL_CART_ID }).onConflictDoNothing();
    const [item] = await tx
      .insert(shoppingCartItems)
      .values({
        cartId: GLOBAL_CART_ID,
        asin: input.asin,
        title: input.title,
        price: input.price,
        quantity: input.quantity,
      })
      .onConflictDoUpdate({
        target: [shoppingCartItems.cartId, shoppingCartItems.asin],
        set: {
          quantity: sql`${shoppingCartItems.quantity} + ${input.quantity}`,
          title: input.title,
          price: input.price,
        },
      })
      .returning();
    await tx
      .update(shoppingCarts)
      .set({ updatedAt: NOW })
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
    const [{ updatedAt }] = await tx
      .select({ updatedAt: shoppingCarts.updatedAt })
      .from(shoppingCarts)
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
    const items = await tx
      .select()
      .from(shoppingCartItems)
      .where(eq(shoppingCartItems.cartId, GLOBAL_CART_ID))
      .orderBy(shoppingCartItems.addedAt);
    return { item, snapshot: { items, updatedAt } };
  });
}

export async function removeCartItem(asin: string): Promise<CartMutation | null> {
  return getDb().transaction(async (tx) => {
    const [removed] = await tx
      .delete(shoppingCartItems)
      .where(and(eq(shoppingCartItems.cartId, GLOBAL_CART_ID), eq(shoppingCartItems.asin, asin)))
      .returning();
    if (!removed) return null;
    await tx
      .update(shoppingCarts)
      .set({ updatedAt: NOW })
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
    const [{ updatedAt }] = await tx
      .select({ updatedAt: shoppingCarts.updatedAt })
      .from(shoppingCarts)
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
    const items = await tx
      .select()
      .from(shoppingCartItems)
      .where(eq(shoppingCartItems.cartId, GLOBAL_CART_ID))
      .orderBy(shoppingCartItems.addedAt);
    return { item: removed, snapshot: { items, updatedAt } };
  });
}

export async function setCartItemQuantity(
  asin: string,
  quantity: number,
): Promise<CartMutation | null> {
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shoppingCartItems)
      .where(and(eq(shoppingCartItems.cartId, GLOBAL_CART_ID), eq(shoppingCartItems.asin, asin)));
    if (!existing) return null;

    let affected = existing;
    if (quantity === 0) {
      await tx
        .delete(shoppingCartItems)
        .where(and(eq(shoppingCartItems.cartId, GLOBAL_CART_ID), eq(shoppingCartItems.asin, asin)));
    } else {
      const [updated] = await tx
        .update(shoppingCartItems)
        .set({ quantity })
        .where(and(eq(shoppingCartItems.cartId, GLOBAL_CART_ID), eq(shoppingCartItems.asin, asin)))
        .returning();
      affected = updated;
    }
    await tx
      .update(shoppingCarts)
      .set({ updatedAt: NOW })
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
    const [{ updatedAt }] = await tx
      .select({ updatedAt: shoppingCarts.updatedAt })
      .from(shoppingCarts)
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
    const items = await tx
      .select()
      .from(shoppingCartItems)
      .where(eq(shoppingCartItems.cartId, GLOBAL_CART_ID))
      .orderBy(shoppingCartItems.addedAt);
    return { item: affected, snapshot: { items, updatedAt } };
  });
}

export async function clearCart(): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.insert(shoppingCarts).values({ id: GLOBAL_CART_ID }).onConflictDoNothing();
    await tx.delete(shoppingCartItems).where(eq(shoppingCartItems.cartId, GLOBAL_CART_ID));
    await tx
      .update(shoppingCarts)
      .set({ updatedAt: NOW })
      .where(eq(shoppingCarts.id, GLOBAL_CART_ID));
  });
}
