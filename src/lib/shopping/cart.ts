import { and, eq, sql } from "drizzle-orm";

import type { CartMutation, CartSnapshot, NewCartItemInput } from "./types.ts";

import { getDb } from "./db.ts";
import { cartItems } from "./schemas/cart-items.ts";
import { carts } from "./schemas/carts.ts";

const GLOBAL_CART_ID = "global";

function now(): string {
  return new Date().toISOString();
}

export async function getCart(): Promise<CartSnapshot> {
  const db = getDb();
  const [cart] = await db
    .select({ updatedAt: carts.updatedAt })
    .from(carts)
    .where(eq(carts.id, GLOBAL_CART_ID));
  const items = await db
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, GLOBAL_CART_ID))
    .orderBy(cartItems.addedAt);
  return { items, updatedAt: cart?.updatedAt ?? null };
}

export async function addCartItem(input: NewCartItemInput): Promise<CartMutation> {
  return getDb().transaction(async (tx) => {
    await tx.insert(carts).values({ id: GLOBAL_CART_ID }).onConflictDoNothing();
    const [item] = await tx
      .insert(cartItems)
      .values({
        cartId: GLOBAL_CART_ID,
        asin: input.asin,
        title: input.title,
        price: input.price,
        quantity: input.quantity,
      })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.asin],
        set: {
          quantity: sql`${cartItems.quantity} + ${input.quantity}`,
          title: input.title,
          price: input.price,
        },
      })
      .returning();
    await tx.update(carts).set({ updatedAt: now() }).where(eq(carts.id, GLOBAL_CART_ID));
    const [{ updatedAt }] = await tx
      .select({ updatedAt: carts.updatedAt })
      .from(carts)
      .where(eq(carts.id, GLOBAL_CART_ID));
    const items = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, GLOBAL_CART_ID))
      .orderBy(cartItems.addedAt);
    return { item, snapshot: { items, updatedAt } };
  });
}

export async function removeCartItem(asin: string): Promise<CartMutation | null> {
  return getDb().transaction(async (tx) => {
    const [removed] = await tx
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, GLOBAL_CART_ID), eq(cartItems.asin, asin)))
      .returning();
    if (!removed) return null;
    await tx.update(carts).set({ updatedAt: now() }).where(eq(carts.id, GLOBAL_CART_ID));
    const [{ updatedAt }] = await tx
      .select({ updatedAt: carts.updatedAt })
      .from(carts)
      .where(eq(carts.id, GLOBAL_CART_ID));
    const items = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, GLOBAL_CART_ID))
      .orderBy(cartItems.addedAt);
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
      .from(cartItems)
      .where(and(eq(cartItems.cartId, GLOBAL_CART_ID), eq(cartItems.asin, asin)));
    if (!existing) return null;

    let affected = existing;
    if (quantity === 0) {
      await tx
        .delete(cartItems)
        .where(and(eq(cartItems.cartId, GLOBAL_CART_ID), eq(cartItems.asin, asin)));
    } else {
      const [updated] = await tx
        .update(cartItems)
        .set({ quantity })
        .where(and(eq(cartItems.cartId, GLOBAL_CART_ID), eq(cartItems.asin, asin)))
        .returning();
      affected = updated;
    }
    await tx.update(carts).set({ updatedAt: now() }).where(eq(carts.id, GLOBAL_CART_ID));
    const [{ updatedAt }] = await tx
      .select({ updatedAt: carts.updatedAt })
      .from(carts)
      .where(eq(carts.id, GLOBAL_CART_ID));
    const items = await tx
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, GLOBAL_CART_ID))
      .orderBy(cartItems.addedAt);
    return { item: affected, snapshot: { items, updatedAt } };
  });
}

export async function clearCart(): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.insert(carts).values({ id: GLOBAL_CART_ID }).onConflictDoNothing();
    await tx.delete(cartItems).where(eq(cartItems.cartId, GLOBAL_CART_ID));
    await tx.update(carts).set({ updatedAt: now() }).where(eq(carts.id, GLOBAL_CART_ID));
  });
}
