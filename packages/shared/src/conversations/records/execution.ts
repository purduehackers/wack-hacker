/** Deployment affinity is durable conversation metadata, independent of turn leases. */
import { z } from "zod";

export const executionIdentitySchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u),
  projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u),
  runtime: z.string().regex(/^eve-\d+\.\d+\.\d+$/u),
  sandbox: z.enum(["vercel-sandbox-v1", "durable-bash-v1", "durable-bash-v2"]),
});

export const executionBindingSchema = z.strictObject({
  version: z.literal(1),
  generation: z.uuid(),
  identity: executionIdentitySchema,
  originHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sessionId: z.string().min(1).max(128).optional(),
});

export type ExecutionIdentity = z.output<typeof executionIdentitySchema>;
export type ExecutionBinding = z.output<typeof executionBindingSchema>;

/** A read-only task command must match the whole pinned generation, including its owner. */
export function sameExecutionBinding(left: ExecutionBinding, right: ExecutionBinding): boolean {
  return (
    left.version === right.version &&
    left.generation === right.generation &&
    left.identity.id === right.identity.id &&
    left.identity.projectId === right.identity.projectId &&
    left.identity.runtime === right.identity.runtime &&
    left.identity.sandbox === right.identity.sandbox &&
    left.originHash === right.originHash &&
    left.sessionId === right.sessionId
  );
}

export const EXECUTION_PROBE_ROUTE = "/discord/execution";
export const EXECUTION_GENERATION_HEADER = "x-wack-execution-generation";

export const executionProbeSchema = z.strictObject({
  ok: z.literal(true),
  protocol: z.literal("session-affinity-v1"),
  identity: executionIdentitySchema,
  sessionId: z.string().min(1).max(128).optional(),
});
