import { createHash } from "node:crypto";

import { z } from "zod";

import { limits } from "./snapshot.ts";

export const operationLimits = { count: 512, bytes: 16 * 1024 * 1024 };
export const commandResultSchema = z.strictObject({
  exitCode: z.int(),
  stdout: z.string().max(limits.outputBytes),
  stderr: z.string().max(limits.outputBytes),
});
export const writeResultSchema = z.strictObject({
  existed: z.boolean(),
  path: z.string(),
  sha256: z.string().length(64),
});
export const voidResultSchema = z.strictObject({ completed: z.literal(true) });
export const operationResultSchema = z.union([
  commandResultSchema,
  writeResultSchema,
  voidResultSchema,
]);
export type OperationResult = z.output<typeof operationResultSchema>;
export interface OperationIdentity {
  readonly key: string;
  readonly owner: string;
}
export interface RecordedOperation extends OperationIdentity {
  readonly fingerprint: string;
}
export interface WorkspaceReference {
  readonly scope: string;
  readonly generation: string;
}

export function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function workspaceScope(sessionId: string): string {
  return hash(JSON.stringify(["wack-durable-bash-v2", sessionId]));
}

/** Coordinates come from a checkpointed Workflow call, never the model input. */
export function operationIdentity(call: {
  sessionId: string;
  turnId: string;
  callId: string;
  toolName: string;
  workflowRunId: string;
}): OperationIdentity {
  if (!call.sessionId || !call.turnId || !call.callId || !call.toolName || !call.workflowRunId)
    throw new Error("Workspace operation requires trusted Workflow call coordinates");
  return {
    key: hash(
      JSON.stringify([
        "workspace-operation-v2",
        call.sessionId,
        call.turnId,
        call.callId,
        call.toolName,
      ]),
    ),
    owner: hash(JSON.stringify(["workspace-owner-v2", call.workflowRunId])),
  };
}

export function operationPayload(
  identity: OperationIdentity,
  kind: string,
  payload: unknown,
): RecordedOperation {
  return {
    ...identity,
    fingerprint: hash(JSON.stringify(["workspace-payload-v2", kind, payload])),
  };
}
