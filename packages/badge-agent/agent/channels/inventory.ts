import { env } from "@repo/agents/env";
import { InventoryError } from "@repo/badges/inventory";
import { inventoryRequestSchema } from "@repo/badges/inventory-contracts";
import { bearerMatches } from "@repo/shared/bearer";
import { defineChannel, POST } from "eve/channels";

import { runtime } from "../lib/runtime.ts";

export default defineChannel({
  routes: [
    POST("/badges/inventory", async (request) => {
      if (
        !bearerMatches(request.headers.get("authorization") ?? undefined, env.AGENT_INGRESS_SECRET)
      )
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      const input = inventoryRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!input.success)
        return Response.json(
          { error: "Check the material, dimensions, and quantity, then try again." },
          { status: 400 },
        );
      try {
        return Response.json(await runtime().inventory.execute(input.data));
      } catch (cause) {
        if (cause instanceof InventoryError)
          return Response.json({ error: cause.message }, { status: 409 });
        console.error("Badge inventory failed:", cause);
        return Response.json({ error: "I couldn’t update inventory. Try again." }, { status: 503 });
      }
    }),
  ],
});
