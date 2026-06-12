import { tool, type Tool, type ToolSet } from "ai";

import type {
  AccessSpec,
  ApplyPolicyOptions,
  AuditLogLike,
  PolicyEvalContext,
  PolicySubject,
} from "./types.ts";

import { isAsyncIterable, wrapToolWithApproval } from "../approvals/runtime.ts";
import { resolveAccessSpec } from "./access.ts";
import { AuditLog } from "./audit.ts";
import { decide } from "./decide.ts";

/**
 * The single enforcement point between a built ToolSet and the model.
 * Collapses the old `filterAdmin` + `wrapApprovalTools` pair: for each tool,
 * `decide()` is evaluated once and its outcome applied —
 *
 * - deny (role):   the tool is omitted entirely (deny-by-absence — the model
 *                  never sees tools above the subject's role, so it can't
 *                  waste context retrying them);
 * - deny (budget): the tool stays visible but its execute is replaced with
 *                  the friendly budget message, so the model can relay it;
 * - confirm/approve: wrapped with the Discord Approve/Deny runtime in the
 *                  resolved mode (self or second-party);
 * - allow:         passed through untouched, except destructive tools which
 *                  gain an execute wrapper that appends executed/failed
 *                  audit rows.
 */
export function applyPolicy(tools: ToolSet, opts: ApplyPolicyOptions): ToolSet {
  const { context, delegateName } = opts;
  const subject: PolicySubject = { userId: context.userId, role: context.role };
  const evalCtx: PolicyEvalContext = {
    channelId: context.channel.id,
    source: context.source,
    budgetState: opts.budget ?? null,
  };
  const audit = opts.audit ?? new AuditLog();

  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const spec = resolveAccessSpec(t);
    const decision = decide(subject, { name, domain: delegateName, access: spec }, evalCtx);

    if (decision.kind === "deny") {
      if (decision.code === "role") continue;
      out[name] = budgetDenyStub(t as Tool, decision.message);
      continue;
    }
    if (decision.kind === "confirm" || decision.kind === "approve") {
      out[name] = wrapToolWithApproval(
        t as Tool,
        name,
        {
          confirmMode: decision.kind === "approve" ? "second-party" : "self",
          risk: spec.risk,
          reason: spec.reason,
        },
        {
          context,
          delegateName,
          timeoutMs: opts.timeoutMs,
          store: opts.store,
          audit,
        },
      );
      continue;
    }
    out[name] =
      spec.risk === "destructive"
        ? wrapWithExecutionAudit(t as Tool, name, spec, { audit, subject, evalCtx, delegateName })
        : t;
  }
  return out;
}

/**
 * Replace a tool's execute with the budget denial. Built fresh (rather than
 * spreading the original) so generator executes and `toModelOutput` hooks
 * don't ride along expecting output shapes the stub doesn't produce.
 */
function budgetDenyStub(original: Tool, message: string): Tool {
  return tool({
    description: original.description ?? "",
    inputSchema: original.inputSchema,
    execute: async () => message,
  });
}

/**
 * Audit-only wrapper for destructive tools that run without confirmation
 * (confirm: "none" overrides). Confirmed tools get their lifecycle rows from
 * the approval runtime instead.
 */
function wrapWithExecutionAudit(
  original: Tool,
  toolName: string,
  spec: AccessSpec,
  info: {
    audit: AuditLogLike;
    subject: PolicySubject;
    evalCtx: PolicyEvalContext;
    delegateName?: string;
  },
): Tool {
  const originalExecute = original.execute as
    | ((input: unknown, runtime: unknown) => unknown)
    | undefined;
  if (!originalExecute) return original;

  const wrapped = async function* (input: unknown, runtime: unknown) {
    const entry = {
      userId: info.subject.userId,
      role: info.subject.role,
      source: info.evalCtx.source,
      delegate: info.delegateName,
      tool: toolName,
      risk: spec.risk,
      input,
      reason: spec.reason,
    };
    try {
      const result = originalExecute(input, runtime);
      if (isAsyncIterable(result)) {
        for await (const v of result) yield v;
      } else {
        yield await (result as Promise<unknown>);
      }
    } catch (err: unknown) {
      await info.audit.record({ ...entry, decision: "failed" });
      throw err;
    }
    await info.audit.record({ ...entry, decision: "executed" });
  };

  return { ...original, execute: wrapped } as Tool;
}
