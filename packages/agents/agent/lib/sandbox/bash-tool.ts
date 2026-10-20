import { defineWorkflowTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { z } from "zod";

import { env } from "../../env.ts";
import { executeBash } from "./executeBash.ts";

const durableBash = defineWorkflowTool({
  description:
    "Run a bounded shell, jq, Python or JavaScript command in the durable workspace. Call workspace_open once before first use. Files persist; each call starts a fresh shell. No network, native processes or background jobs. Maximum 10 seconds. Workflow replay returns the original committed result without repeating file mutations.",
  inputSchema: z.strictObject({ command: z.string().max(65_536) }),
  execute: executeBash,
});

export default env.DURABLE_BASH_ENABLED ? durableBash : bash;
