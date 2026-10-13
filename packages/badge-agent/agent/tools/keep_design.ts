import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Cancel a requested revision when the designer asks to keep the current design. Read review_status first. This does not confirm the design or publish it.",
  inputSchema: z.strictObject({ version: z.int().nonnegative() }),
  execute: (input, ctx) => reviewAction(ctx, input.version, { kind: "keep-design" }),
});
