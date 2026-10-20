import type { WorkflowToolContext } from "eve/tools";

import { replaceWorkspaceFile, resolveWorkspace } from "./workflow-steps.ts";

export async function executeWriteFile(
  input: { filePath: string; content: string; expectedSha256: string },
  ctx: WorkflowToolContext,
) {
  "use workflow";
  const reference = await resolveWorkspace(ctx);
  return await replaceWorkspaceFile(reference, input, ctx);
}
