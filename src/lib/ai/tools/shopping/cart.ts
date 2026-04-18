import { tool } from "ai";
import { z } from "zod";

import type { CartItem } from "../../../shopping/types.ts";

import { clearCart, getCart, updateCart } from "../../../shopping/cart.ts";

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
  execute: async ({ asin, title, price, quantity }) =>
    JSON.stringify(
      await updateCart((cart) => {
        const existing = cart.items.find((entry) => entry.asin === asin);
        if (existing) {
          existing.quantity += quantity;
          existing.title = title;
          existing.price = price;
        } else {
          cart.items.push({ asin, title, price, quantity });
        }
        return { added: { asin, title, price, quantity }, ...summarize(cart.items) };
      }),
    ),
});

export const remove_from_cart = tool({
  description: "Remove a product from the cart by ASIN.",
  inputSchema: z.object({
    asin: z.string().min(1).describe("ASIN of the item to remove"),
  }),
  execute: async ({ asin }) =>
    JSON.stringify(
      await updateCart((cart) => {
        const index = cart.items.findIndex((entry) => entry.asin === asin);
        if (index === -1) return { error: `ASIN ${asin} not in cart` };
        const [removed] = cart.items.splice(index, 1);
        return { removed, ...summarize(cart.items) };
      }),
    ),
});

export const update_quantity = tool({
  description:
    "Set the quantity of an item in the cart. Quantity of 0 removes the item. Item must already be in the cart.",
  inputSchema: z.object({
    asin: z.string().min(1).describe("ASIN of the item to update"),
    quantity: z.number().int().min(0).describe("New quantity (0 removes the item)"),
  }),
  execute: async ({ asin, quantity }) =>
    JSON.stringify(
      await updateCart((cart) => {
        const index = cart.items.findIndex((entry) => entry.asin === asin);
        if (index === -1) return { error: `ASIN ${asin} not in cart` };
        if (quantity === 0) cart.items.splice(index, 1);
        else cart.items[index].quantity = quantity;
        return { asin, quantity, ...summarize(cart.items) };
      }),
    ),
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
    const cart = await getCart();
    const totalPages = Math.max(1, Math.ceil(cart.items.length / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const start = (current - 1) * PAGE_SIZE;
    return JSON.stringify({
      page: current,
      total_pages: totalPages,
      page_size: PAGE_SIZE,
      items: cart.items.slice(start, start + PAGE_SIZE),
      ...summarize(cart.items),
      updated_at: cart.updatedAt,
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
