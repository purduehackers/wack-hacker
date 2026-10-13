import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Retry a failed step or refresh changed event details, stock, or event choices when the designer asks. Read review_status first. Refresh starts file checks again; retry resumes the failed work.",
  inputSchema: z.strictObject({
    version: z.int().nonnegative(),
    mode: z.enum(["retry", "refresh"]),
  }),
  execute: (input, ctx) => reviewAction(ctx, input.version, { kind: input.mode }),
});
