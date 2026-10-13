import { criterionSchema } from "@repo/badges";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "When the designer wants to upload a new badge or stamp, request that SVG in this thread. The bot accepts the next attachment directly. Never edit their design or ask them to paste SVG code.",
  inputSchema: z.strictObject({ version: z.int().nonnegative(), design: criterionSchema }),
  execute: (input, ctx) => reviewAction(ctx, input.version, { kind: "upload", role: input.design }),
});
