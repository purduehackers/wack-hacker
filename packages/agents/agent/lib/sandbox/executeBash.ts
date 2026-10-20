import type { WorkflowToolContext } from "eve/tools";

import { resolveWorkspace, runWorkspaceCommand } from "./workflow-steps.ts";

export async function executeBash(input: { command: string }, ctx: WorkflowToolContext) {
  "use workflow";
  const reference = await resolveWorkspace(ctx);
  return await runWorkspaceCommand(reference, input, ctx);
}
