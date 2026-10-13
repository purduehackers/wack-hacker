import { defineTool } from "eve/tools";
import { z } from "zod";

import { reviewAction } from "../lib/tools.ts";

export default defineTool({
  description:
    "Identify uploaded designs from the designer's explicit statement: A/B for two files, or badge/stamp for one file. Filenames alone do not establish roles. Read review_status first.",
  inputSchema: z.strictObject({
    version: z.int().nonnegative(),
    choice: z.enum(["A", "B", "badge", "stamp"]),
  }),
  execute: (input, ctx) =>
    reviewAction(
      ctx,
      input.version,
      input.choice === "A" || input.choice === "B"
        ? { kind: "roles", badge: Number(input.choice !== "A") }
        : { kind: "replace", role: input.choice },
    ),
});
