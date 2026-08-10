import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { initiativeStatus } from "../../constants.ts";

export const update_initiative = defineTool({
  description: "Update an initiative by ID. Only include fields to change.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    name: z.string().exactOptional(),
    description: z.string().exactOptional(),
    content: z.string().exactOptional().describe("Markdown"),
    ownerId: z.string().exactOptional(),
    status: initiativeStatus.exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateInitiative(id, input);
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to update initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});
