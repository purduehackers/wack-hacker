import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Choose the acrylic the designer requested from review_status.materials. Omit id to show the material menu. Ask if their description matches several materials.",
  inputSchema: z.strictObject({ version: z.int().nonnegative(), id: z.string().optional() }),
  execute: (input, ctx) =>
    reviewAction(
      ctx,
      input.version,
      input.id ? { kind: "material", id: input.id } : { kind: "choose-material" },
    ),
});
