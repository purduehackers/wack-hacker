import { tool } from "ai";
import { z } from "zod";

import type { CartItem } from "../../../shopping/types.ts";

import {
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  setCartItemQuantity,
} from "../../../shopping/cart.ts";

const PAGE_SIZE = 10;

function summarize(items: CartItem[]) {
  let subtotal = 0;
  let count = 0;
  for (const entry of items) {
    subtotal += entry.price * entry.quantity;
    count += entry.quantity;
  }
  return { subtotal: Number(subtotal.toFixed(2)), item_count: count };
}

export const add_to_cart = tool({
  description:
    "Add a product to the shared cart. If the ASIN is already in the cart, the quantity is increased. Use search_products first to get the ASIN, title, and price.",
  inputSchema: z.object({
    asin: z.string().min(1).describe("Amazon ASIN from search_products"),
    title: z.string().min(1).describe("Product title"),
    price: z.number().min(0).describe("Unit price in USD"),
    quantity: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Quantity to add. Merges with existing quantity for this ASIN."),
  }),
  execute: async ({ asin, title, price, quantity }) => {
    const { item, snapshot } = await addCartItem({ asin, title, price, quantity });
    return JSON.stringify({ added: item, ...summarize(snapshot.items) });
  },
});

export const remove_from_cart = tool({
  description: "Remove a product from the cart by ASIN.",
  inputSchema: z.object({
    asin: z.string().min(1).describe("ASIN of the item to remove"),
  }),
  execute: async ({ asin }) => {
    const result = await removeCartItem(asin);
    if (!result) return JSON.stringify({ error: `ASIN ${asin} not in cart` });
    return JSON.stringify({ removed: result.item, ...summarize(result.snapshot.items) });
  },
});

export const update_quantity = tool({
  description:
    "Set the quantity of an item in the cart. Quantity of 0 removes the item. Item must already be in the cart.",
  inputSchema: z.object({
    asin: z.string().min(1).describe("ASIN of the item to update"),
    quantity: z.number().int().min(0).describe("New quantity (0 removes the item)"),
  }),
  execute: async ({ asin, quantity }) => {
    const result = await setCartItemQuantity(asin, quantity);
    if (!result) return JSON.stringify({ error: `ASIN ${asin} not in cart` });
    return JSON.stringify({ asin, quantity, ...summarize(result.snapshot.items) });
  },
});

export const view_cart = tool({
  description:
    "View the shared cart. Items are paginated to keep Discord messages short — pass `page` (1-indexed) to navigate when there are many items.",
  inputSchema: z.object({
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(`Page number (1-indexed). Page size is ${PAGE_SIZE} items.`),
  }),
  execute: async ({ page }) => {
    const snapshot = await getCart();
    const totalPages = Math.max(1, Math.ceil(snapshot.items.length / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const start = (current - 1) * PAGE_SIZE;
    return JSON.stringify({
      page: current,
      total_pages: totalPages,
      page_size: PAGE_SIZE,
      items: snapshot.items.slice(start, start + PAGE_SIZE),
      ...summarize(snapshot.items),
      updated_at: snapshot.updatedAt,
    });
  },
});

export const clear_cart = tool({
  description:
    "Remove every item from the shared cart. This is irreversible — always confirm with the user before calling.",
  inputSchema: z.object({}),
  execute: async () => {
    await clearCart();
    return JSON.stringify({ cleared: true });
  },
});
