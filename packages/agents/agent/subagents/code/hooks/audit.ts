import { createHash } from "node:crypto";

import { AuditDecision } from "@repo/shared/db";
import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { defineHook } from "eve/hooks";
import { z } from "zod";

import { env } from "../../../lib/env.ts";
import { createAuditStore, requirePrincipal, RiskLevel } from "../../../lib/policy/index.ts";

const tools = {
  checkout_repository: RiskLevel.Write,
  read_file: RiskLevel.Read,
  glob: RiskLevel.Read,
  grep: RiskLevel.Read,
  bash: RiskLevel.Write,
  write_file: RiskLevel.Write,
  edit_file: RiskLevel.Write,
  remove_path: RiskLevel.Destructive,
  code_post_finish: RiskLevel.Destructive,
} as const;
type CodeToolName = keyof typeof tools;
const failedOutput = z.object({ ok: z.literal(false) });
const audit = createAuditStore({
  url: env.TURSO_DATABASE_URL,
  ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
});

function isCodeTool(value: string): value is CodeToolName {
  return Object.hasOwn(tools, value);
}

function opaqueAuditInput(value: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = "[unserializable]";
  }
  return {
    fields:
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.keys(value).sort().slice(0, 100)
        : [],
    kind: Array.isArray(value) ? "array" : typeof value,
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

async function record(
  id: string,
  current: Parameters<typeof requirePrincipal>[0],
  tool: CodeToolName,
  input: unknown,
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
