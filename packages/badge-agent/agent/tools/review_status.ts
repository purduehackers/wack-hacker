import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewStatus } from "../lib/tools.ts";

export default defineTool({
  description:
    "Read this thread's current file checks, design confirmations, and next action. Required before every status claim.",
  inputSchema: z.strictObject({}),
  execute: async (_input, ctx) => reviewStatus(ctx),
});
