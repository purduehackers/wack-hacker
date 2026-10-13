import { criterionSchema } from "@repo/badges";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Record the designer's explicit confirmation of the current badge or stamp. Read review_status first; confirm only the current step, never both designs from one message.",
  inputSchema: z.strictObject({ version: z.int().nonnegative(), design: criterionSchema }),
  execute: (input, ctx) =>
    reviewAction(ctx, input.version, {
      kind: "decision",
      criterion: input.design,
      verdict: "approve",
      note: "",
    }),
});
