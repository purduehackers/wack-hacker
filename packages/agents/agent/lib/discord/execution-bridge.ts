/**
 * This bridge deliberately uses no Eve internals or version-specific API.
 * It is backportable to 0.31: only resolveSession(address), fixed Session handles,
 * and the existing Redis conversation aggregate are required.
 */
import {
  EXECUTION_GENERATION_HEADER,
  executionIdentitySchema,
  type ConversationStore,
  type ExecutionIdentity,
} from "@repo/shared/conversations";
import { Result } from "@repo/shared/result";
import { z } from "zod";

const addressSchema = z.strictObject({ continuationKey: z.string().regex(/^\d{17,20}$/u) });

function denied(message: string, status = 409): Response {
  return Response.json({ ok: false, tag: "ExecutionUnavailable", message }, { status });
}

export function createExecutionBridge(deps: {
  readonly store: Pick<ConversationStore, "executions" | "execution" | "deliveries">;
  readonly identity: () => ExecutionIdentity | undefined;
}) {
  return {
    async probe(
      request: Request,
      resolveSession: (address: string) => Promise<{ readonly id: string } | undefined>,
    ) {
      const identity = deps.identity();
      if (identity === undefined) return denied("execution identity is not configured", 503);
      const address = addressSchema.safeParse(await request.json());
      if (!address.success) return denied("invalid continuation address", 400);
      const session = await resolveSession(address.data.continuationKey);
      const held = await deps.store.deliveries.readStrict(address.data.continuationKey);
      if (Result.isError(held)) return denied("existing delivery is unreadable", 503);
      if (session === undefined && held.value !== undefined && held.value.sessionId !== "") {
        return denied(
          "a recorded session lost its continuation ownership; operator recovery is required",
          503,
        );
      }
      return Response.json({
        ok: true,
        protocol: "session-affinity-v1",
        identity,
        ...(session === undefined ? {} : { sessionId: session.id }),
      });
    },

    async guard(request: Request, continuationKey: string) {
      const identity = deps.identity();
      if (identity === undefined) return denied("execution identity is not configured", 503);
      const stored = await deps.store.executions.read(continuationKey);
      if (Result.isError(stored)) return denied("execution binding is unreadable", 503);
      const binding = stored.value;
      if (
        binding === undefined ||
        request.headers.get(EXECUTION_GENERATION_HEADER) !== binding.generation ||
        binding.identity.id !== identity.id ||
        binding.identity.projectId !== identity.projectId ||
        binding.identity.runtime !== identity.runtime ||
        binding.identity.sandbox !== identity.sandbox
      )
        return denied("this continuation is not bound to this execution deployment");
      return binding;
    },
  };
}

/** Vercel supplies the actual deployment ID; local tests may provide an explicit ID. */
export function executionIdentity(input: {
  readonly deploymentId: string | undefined;
  readonly localId: string | undefined;
  readonly projectId: string | undefined;
  readonly runtime: string;
  readonly sandbox: ExecutionIdentity["sandbox"];
}): ExecutionIdentity | undefined {
  return executionIdentitySchema.safeParse({
    id: input.deploymentId ?? input.localId,
    projectId: input.projectId,
    runtime: input.runtime,
    sandbox: input.sandbox,
  }).data;
}

/** Fixed-session APIs can refuse without creating a replacement. */
export function acceptedSessionId(result: {
  readonly status: string;
  readonly sessionId?: string;
}): string {
  if (result.status !== "accepted" || result.sessionId === undefined) {
    throw new Error("bound execution session is not active; no replacement was created");
  }
  return result.sessionId;
}
