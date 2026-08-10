import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { initiativeStatus } from "../../constants.ts";

export const create_initiative = defineTool({
  description:
    "Create an initiative (strategic goal grouping multiple projects). Supports owner, status (Planned/Active/Completed), target date, and Markdown content.",
  access: { risk: "write" },
  input: z.strictObject({
    name: z.string(),
    description: z.string().exactOptional(),
    content: z.string().exactOptional().describe("Markdown"),
    ownerId: z.string().exactOptional(),
    status: initiativeStatus.exactOptional(),
    targetDate: z.iso.date().exactOptional().describe("ISO date"),
  }),
  execute: async (input) => {
    const payload = await linear.createInitiative(input);
    const initiative = await payload.initiative;
    if (!initiative) return "Failed to create initiative";
    return JSON.stringify({ id: initiative.id, name: initiative.name, url: initiative.url });
  },
});
