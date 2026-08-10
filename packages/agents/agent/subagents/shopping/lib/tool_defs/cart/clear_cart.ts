import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { clearCart } from "../../cart-store.ts";

export const clear_cart = defineTool({
  description:
    "Remove every item from the shared cart. This is irreversible — always confirm with the user before calling.",
  access: { risk: "write", confirm: "self" },
  requires: "TURSO_DATABASE_URL",
  input: z.strictObject({}),
  execute: async () => {
    await clearCart();
    return { cleared: true };
  },
});
