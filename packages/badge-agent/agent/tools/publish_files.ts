import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Publish the current cutting files only on the designer's explicit request. This deducts material inventory. Requires both design confirmations and a chosen quantity. Never infer publishing permission from a design confirmation.",
  inputSchema: z.strictObject({ version: z.int().nonnegative() }),
  execute: (input, ctx) => reviewAction(ctx, input.version, { kind: "publish" }),
});
