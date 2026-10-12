import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewStatus } from "../lib/tools.ts";

export default defineTool({
  description:
    "Read the authenticated thread's durable review, current evidence, missing gates and guidance. Required before every status claim.",
  inputSchema: z.strictObject({}),
  execute: async (_input, ctx) => reviewStatus(ctx),
});
