import { defineTool, disableTool } from "eve/tools";
import { z } from "zod";

import { env } from "../../env.ts";
import { guardToolExecution } from "../../lib/serialization.ts";

const workspaceOpen = defineTool({
  description:
    "Open this session's workspace before its first bash or write_file call. Reuses existing files and prepared seeds; does not run commands.",
  inputSchema: z.strictObject({}),
  async execute(_input, ctx) {
    return guardToolExecution(async () => {
      await ctx.getSandbox();
      return { ready: true };
    });
  },
});

export default env.DURABLE_BASH_ENABLED ? workspaceOpen : disableTool();
