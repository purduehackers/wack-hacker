import type { WorkflowStepToolContext } from "eve/tools";

import type { WorkspaceReference } from "./operation.ts";

export async function resolveWorkspace(ctx: WorkflowStepToolContext): Promise<WorkspaceReference> {
  "use step";
  const service = await import("./workflow-service.ts");
  return await service.resolveWorkspace(ctx);
}

export async function runWorkspaceCommand(
  reference: WorkspaceReference,
  input: { command: string },
  ctx: WorkflowStepToolContext,
) {
  "use step";
  const service = await import("./workflow-service.ts");
  const { getWorkflowMetadata } = await import("workflow");
  return await service.runWorkspaceCommand(
    reference,
    input,
    ctx,
    getWorkflowMetadata().workflowRunId,
  );
}

export async function replaceWorkspaceFile(
  reference: WorkspaceReference,
  input: { filePath: string; content: string; expectedSha256: string },
  ctx: WorkflowStepToolContext,
) {
  "use step";
  const service = await import("./workflow-service.ts");
  const { getWorkflowMetadata } = await import("workflow");
  return await service.replaceWorkspaceFile(
    reference,
    input,
    ctx,
    getWorkflowMetadata().workflowRunId,
  );
}
