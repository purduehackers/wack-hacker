import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const list_initiatives = defineTool({
  description: "List all initiatives with name, status, target date, and URL.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const r = await linear.initiatives();
    return JSON.stringify(
      r.nodes.map((i) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        targetDate: i.targetDate,
        url: i.url,
      })),
    );
  },
});
