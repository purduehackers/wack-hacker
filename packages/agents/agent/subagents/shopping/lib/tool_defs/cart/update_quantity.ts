import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { setCartItemQuantity } from "../../cart-store.ts";
import { summarize } from "../../projections.ts";

export const update_quantity = defineTool({
  description:
    "Set the quantity of an item in the cart. Quantity of 0 removes the item. Item must already be in the cart.",
  access: { risk: "write" },
  requires: "TURSO_DATABASE_URL",
  input: z.strictObject({
    asin: z.string().trim().min(1).describe("ASIN of the item to update"),
    quantity: z.int().min(0).describe("New quantity (0 removes the item)"),
  }),
  execute: async ({ asin, quantity }) => {
    const result = await setCartItemQuantity(asin, quantity);
    if (!result) return { error: `ASIN ${asin} not in cart` };
    return { asin, quantity, ...summarize(result.snapshot.items) };
  },
});
