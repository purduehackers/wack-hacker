/* oxlint-disable unicorn/no-null -- The cart contract uses null for a snapshot that has never been updated. */
import { getDb, shoppingCartItems, shoppingCarts } from "@repo/shared/db";

import { env } from "../../../lib/env.ts";
import type { CartMutation, CartSnapshot, NewCartItemInput } from "./shopping-types.ts";

const GLOBAL_CART_ID = "global";

function db() {
  return getDb({
    url: env.TURSO_DATABASE_URL,
    ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
  });
}

function now(): string {
  return new Date().toISOString();
}

export async function getCart(): Promise<CartSnapshot> {
  const [cart] = await db().select({ updatedAt: shoppingCarts.updatedAt }).from(shoppingCarts);
  const items = await db().select().from(shoppingCartItems).orderBy(shoppingCartItems.addedAt);
  return { items, updatedAt: cart?.updatedAt ?? null };
}

export async function addCartItem(input: NewCartItemInput): Promise<CartMutation> {
  return db().transaction(async (tx) => {
    await tx.insert(shoppingCarts).values({ id: GLOBAL_CART_ID }).onConflictDoNothing();
    const existing = (await tx.select().from(shoppingCartItems)).find(
      (item) => item.asin === input.asin,
    );
    const [affectedItem] = await tx
      .insert(shoppingCartItems)
      .values({
        cartId: GLOBAL_CART_ID,
        asin: input.asin,
        title: input.title,
        price: input.price,
        quantity: (existing?.quantity ?? 0) + input.quantity,
      })
      .onConflictDoUpdate({
        target: [shoppingCartItems.cartId, shoppingCartItems.asin],
        set: {
          quantity: (existing?.quantity ?? 0) + input.quantity,
          title: input.title,
          price: input.price,
        },
      })
      .returning();
    if (affectedItem === undefined) throw new Error("Shopping cart insert returned no item");
    const updatedAt = now();
    await tx.update(shoppingCarts).set({ updatedAt });
    const snapshotItems = await tx
      .select()
      .from(shoppingCartItems)
      .orderBy(shoppingCartItems.addedAt);
    return { item: affectedItem, snapshot: { items: snapshotItems, updatedAt } };
  });
}

export async function removeCartItem(asin: string): Promise<CartMutation | null> {
  return db().transaction(async (tx) => {
    const current = await tx.select().from(shoppingCartItems).orderBy(shoppingCartItems.addedAt);
    const removed = current.find((item) => item.asin === asin);
    if (removed === undefined) return null;
    const retained = current.filter((item) => item.asin !== asin);
    await tx.delete(shoppingCartItems);
    if (retained.length > 0) await tx.insert(shoppingCartItems).values(retained);
    const updatedAt = now();
    await tx.update(shoppingCarts).set({ updatedAt });
    return { item: removed, snapshot: { items: retained, updatedAt } };
  });
}

export async function setCartItemQuantity(
  asin: string,
  quantity: number,
): Promise<CartMutation | null> {
  return db().transaction(async (tx) => {
    const current = await tx.select().from(shoppingCartItems).orderBy(shoppingCartItems.addedAt);
    const existing = current.find((item) => item.asin === asin);
    if (existing === undefined) return null;
    const affected = { ...existing, quantity };
    const retained = current
      .filter((item) => item.asin !== asin)
      .concat(quantity === 0 ? [] : [affected]);
    await tx.delete(shoppingCartItems);
    if (retained.length > 0) await tx.insert(shoppingCartItems).values(retained);
    const updatedAt = now();
    await tx.update(shoppingCarts).set({ updatedAt });
    const snapshotItems = await tx
      .select()
      .from(shoppingCartItems)
      .orderBy(shoppingCartItems.addedAt);
    return { item: existing, snapshot: { items: snapshotItems, updatedAt } };
  });
}

export async function clearCart(): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(shoppingCarts).values({ id: GLOBAL_CART_ID }).onConflictDoNothing();
    await tx.delete(shoppingCartItems);
    await tx.update(shoppingCarts).set({ updatedAt: now() });
  });
}
