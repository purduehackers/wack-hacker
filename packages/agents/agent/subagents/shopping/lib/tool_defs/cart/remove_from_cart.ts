import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { removeCartItem } from "../../cart-store.ts";
import { summarize, toPublic } from "../../constants.ts";

export const remove_from_cart = defineTool({
  description: "Remove a product from the cart by ASIN.",
  access: { risk: "write", confirm: "self" },
  requires: "TURSO_DATABASE_URL",
  input: z.strictObject({
    asin: z.string().trim().min(1).describe("ASIN of the item to remove"),
  }),
  execute: async ({ asin }) => {
    const result = await removeCartItem(asin);
    if (!result) return { error: `ASIN ${asin} not in cart` };
    return {
      removed: toPublic(result.item),
      ...summarize(result.snapshot.items),
    };
  },
});
