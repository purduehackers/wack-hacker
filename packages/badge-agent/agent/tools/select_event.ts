import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Select the Hack Night the designer named, using its exact id from review_status.events. Preserve version strings, including trailing zeros. Ask if ambiguous.",
  inputSchema: z.strictObject({ version: z.int().nonnegative(), id: z.string() }),
  execute: (input, ctx) => reviewAction(ctx, input.version, { kind: "event", id: input.id }),
});
