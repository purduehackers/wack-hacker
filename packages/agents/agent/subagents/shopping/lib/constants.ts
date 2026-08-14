import type { CartItem, PublicCartItem } from "./shopping-types.ts";

/**
 * Projections shared across this domain's cart tools.
 *
 * Every cart mutation answers the same two questions — what changed, and what
 * the cart now totals. The row projection and the running total therefore
 * live here once. Restating them per tool would let the two drift apart.
 */

/** A cart row as the model sees it: snake_case, no cart id, no storage columns. */
export function toPublic(item: CartItem): PublicCartItem {
  return {
    asin: item.asin,
    title: item.title,
    price: item.price,
    quantity: item.quantity,
    added_at: item.addedAt,
  };
}

/** Subtotal and item count over the whole cart, returned beside every mutation. */
export function summarize(items: CartItem[]) {
  let subtotal = 0;
  let count = 0;
  for (const entry of items) {
    subtotal += entry.price * entry.quantity;
    count += entry.quantity;
  }
  return { subtotal: Number(subtotal.toFixed(2)), item_count: count };
}
