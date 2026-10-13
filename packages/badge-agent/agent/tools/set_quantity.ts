import { targetCountSchema } from "@repo/badges";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Set the designer's requested badge count. Omit count to show calculated quantity choices. Read review_status first. Automatic resizing keeps both design confirmations and updates the arrangement.",
  inputSchema: z.strictObject({
    version: z.int().nonnegative(),
    count: targetCountSchema.optional(),
  }),
  execute: (input, ctx) =>
    reviewAction(ctx, input.version, {
      kind: "quantity",
      ...(input.count === undefined ? {} : { count: input.count }),
    }),
});
