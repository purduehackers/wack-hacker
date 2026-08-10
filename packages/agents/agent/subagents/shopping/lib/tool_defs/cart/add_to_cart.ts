import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { addCartItem } from "../../cart-store.ts";
import { summarize, toPublic } from "../../constants.ts";

export const add_to_cart = defineTool({
  description:
    "Add a product to the shared cart. If the ASIN is already in the cart, the quantity is increased. Use search_products first to get the ASIN, title, and price.",
  access: { risk: "write" },
  requires: "TURSO_DATABASE_URL",
  input: z.strictObject({
    asin: z.string().trim().min(1).describe("Amazon ASIN from search_products"),
    title: z.string().trim().min(1).describe("Product title"),
    price: z.number().min(0).describe("Unit price in USD"),
    quantity: z
      .int()
      .min(1)
      .default(1)
      .describe("Quantity to add. Merges with existing quantity for this ASIN."),
  }),
  execute: async ({ asin, title, price, quantity }) => {
    const { item, snapshot } = await addCartItem({ asin, title, price, quantity });
    return { added: toPublic(item), ...summarize(snapshot.items) };
  },
});
