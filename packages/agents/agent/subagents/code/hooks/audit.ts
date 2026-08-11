import { createHash } from "node:crypto";

import { AuditDecision } from "@repo/shared/db";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";
import { z } from "zod";

import { env } from "../../../env.ts";
import { createAuditStore, requirePrincipal, RiskLevel } from "../../../lib/policy/index.ts";
import type { JsonValue } from "../../../lib/serialization.ts";

/**
 * The delegated code surface, in full. Repository mutation now happens through
 * one tool — the Codex task — so the audit row for `code_task` is the record of
 * every edit that later reaches `code_post_finish`.
 */
const tools = {
  code_task: RiskLevel.Write,
  code_post_finish: RiskLevel.Destructive,
} as const;
type CodeToolName = keyof typeof tools;
const failedOutput = z.object({ ok: z.literal(false) });
/** A JSON object, excluding arrays and null — the only shape with audit-worthy field names. */
const jsonObject = z.looseObject({});
/**
 * The `typeof`-style tag the audit row records, derived by matching the value
 * against the JSON shapes instead of interrogating its runtime type.
 *
 * Every option is deliberately shallow. A recursive `z.json()` here would walk
 * the entire payload and raise `RangeError: Maximum call stack size exceeded`
 * on a cyclic or deeply nested value — which `.catch()` does not intercept,
 * because it supplies a fallback for validation issues, not thrown errors. The
 * `JSON.stringify` guard below exists for exactly that class of input, so the
 * tag must not be the thing that reintroduces the throw.
 */
const jsonKind = z.union([
  z.array(z.unknown()).transform(() => "array" as const),
  z.string().transform(() => "string" as const),
  z.number().transform(() => "number" as const),
  z.boolean().transform(() => "boolean" as const),
  // Total terminal option, so auditing can never be the thing that fails a turn:
  // objects and `null` alike land here, exactly as `typeof` reported them.
  z.unknown().transform(() => "object" as const),
]);
const audit = createAuditStore({
  url: env.TURSO_DATABASE_URL,
  ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
});

function isCodeTool(value: string): value is CodeToolName {
  return Object.hasOwn(tools, value);
}

function opaqueAuditInput(value: JsonValue) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = "[unserializable]";
  }
  const fields = jsonObject.safeParse(value);
  return {
    fields: fields.success ? Object.keys(fields.data).sort().slice(0, 100) : [],
    kind: jsonKind.parse(value),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

async function record(
  id: string,
  current: Parameters<typeof requirePrincipal>[0],
  tool: CodeToolName,
  input: JsonValue,
  decision: (typeof AuditDecision)[keyof typeof AuditDecision],
): Promise<void> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return;
  const outcome = await audit.record({
    id,
    principal: principal.value,
    delegate: "code",
    tool,
    risk: tools[tool],
    input: opaqueAuditInput(input),
    decision,
    decidedBy: principal.value.userId,
  });
  if (Result.isError(outcome)) {
    console.warn("Code action audit unavailable", serializeError(outcome.error));
  }
}

export default defineHook({
  events: {
    async "actions.requested"(event, ctx) {
      for (const action of event.data.actions) {
        if (action.kind !== "tool-call" || !isCodeTool(action.toolName)) continue;
        await record(
          `${event.meta.id}:${action.callId}`,
          ctx.session.auth.current,
          action.toolName,
          action.input,
          AuditDecision.Requested,
        );
      }
    },
    async "action.result"(event, ctx) {
      const result = event.data.result;
      if (result.kind !== "tool-result") return;
      const { toolName } = result;
      if (!isCodeTool(toolName)) return;
      const decision =
        result.isError || failedOutput.safeParse(result.output).success
          ? AuditDecision.Failed
          : AuditDecision.Executed;
      await record(
        `${event.meta.id}:${result.callId}`,
        ctx.session.auth.current,
        toolName,
        result.output,
        decision,
      );
    },
  },
});
