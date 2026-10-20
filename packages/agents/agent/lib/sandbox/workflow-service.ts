import type { WorkflowStepToolContext } from "eve/tools";

import { env } from "../../env.ts";
import { workspaceStore } from "./environment.ts";
import { operationIdentity, workspaceScope, type WorkspaceReference } from "./operation.ts";
import { DurableSession } from "./session.ts";
import type { WorkspaceStore } from "./store.ts";

function enabled(): void {
  if (!env.DURABLE_BASH_ENABLED)
    throw new Error("This Workflow belongs to the durable workspace v2 deployment");
}

export async function resolveWorkspace(ctx: WorkflowStepToolContext): Promise<WorkspaceReference> {
  enabled();
  return await workspaceStore().reference(workspaceScope(ctx.session.id));
}

export async function runWorkspaceCommand(
  reference: WorkspaceReference,
  input: { command: string },
  ctx: WorkflowStepToolContext,
  workflowRunId: string,
) {
  enabled();
  return await executeWorkspaceCommand(workspaceStore(), reference, input, ctx, workflowRunId);
}

export async function replaceWorkspaceFile(
  reference: WorkspaceReference,
  input: { filePath: string; content: string; expectedSha256: string },
  ctx: WorkflowStepToolContext,
  workflowRunId: string,
) {
  enabled();
  const store = workspaceStore();
  const sandbox = await sessionFor(store, reference, ctx);
  try {
    return await sandbox.replaceFile(
      {
        path: input.filePath,
        content: input.content,
        expectedSha256: input.expectedSha256,
        abortSignal: ctx.abortSignal,
      },
      identity(ctx, workflowRunId),
    );
  } finally {
    await sandbox.close();
  }
}

function identity(ctx: WorkflowStepToolContext, workflowRunId: string) {
  return operationIdentity({
    sessionId: ctx.session.id,
    turnId: ctx.session.turn.id,
    callId: ctx.callId,
    toolName: ctx.toolName,
    workflowRunId,
  });
}

async function sessionFor(
  store: WorkspaceStore,
  reference: WorkspaceReference,
  ctx: WorkflowStepToolContext,
) {
  ctx.abortSignal.throwIfAborted();
  if (reference.scope !== workspaceScope(ctx.session.id))
    throw new Error("Workspace reference does not belong to this Workflow session");
  // The reference was checkpointed before this mutation step. Never reopen a
  // deleted generation or silently target a replacement workspace on replay.
  return new DurableSession(store, await store.read(reference.scope, reference.generation));
}

export async function executeWorkspaceCommand(
  store: WorkspaceStore,
  reference: WorkspaceReference,
  input: { command: string },
  ctx: WorkflowStepToolContext,
  workflowRunId: string,
) {
  const sandbox = await sessionFor(store, reference, ctx);
  try {
    const result = await sandbox.run(
      { command: input.command, abortSignal: ctx.abortSignal },
      identity(ctx, workflowRunId),
    );
    return { status: "completed" as const, ...result };
  } finally {
    await sandbox.close();
  }
}
