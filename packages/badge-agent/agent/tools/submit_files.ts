import { defineTool } from "eve/tools";
import { z } from "zod";

import { submitFiles } from "../lib/tools.ts";

export default defineTool({
  description:
    "Submit the current authenticated Discord message's attached SVGs or revision when its author requests review. Does not identify roles or approve anything.",
  inputSchema: z.strictObject({}),
  execute: async (_input, ctx) => submitFiles(ctx),
});
