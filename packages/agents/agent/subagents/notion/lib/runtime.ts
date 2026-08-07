import { AuditDecision } from "@repo/shared/db";
import { UserRole } from "@repo/shared/discord";
import {
  Forbidden,
  RateLimited,
  Transient,
  UpstreamError,
  httpStatusOf,
  serializeError,
} from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import type { ApprovalContext, ApprovalStatus, ToolContext } from "eve/tools";
import type { z } from "zod";

import { assertToolOutput } from "../../../lib/core/serialization.ts";
import { env } from "../../../lib/env.ts";
import { resolveExecutionAuthority } from "../../../lib/policy/execution-authority.ts";
import {
  ApprovalPolicyStore,
  BudgetStore,
  Confirmation,
  createAuditStore,
  decideCapability,
  requirePrincipal,
  type PolicyEvaluationContext,
  type PolicyPrincipal,
} from "../../../lib/policy/index.ts";
import type { NotionToolSpec } from "./define-tool.ts";
import { descriptorForTool, isNotionToolName } from "./descriptors.ts";
import { NOTION_TOOLS, type NotionToolName } from "./tool-registry.ts";

const budgetStore = new BudgetStore(
  getRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
);
const approvalPolicyStore = new ApprovalPolicyStore(
  getRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
);
const auditStore = createAuditStore({
  url: env.TURSO_DATABASE_URL,
  ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
});

async function evaluationContext(principal: PolicyPrincipal): Promise<PolicyEvaluationContext> {
  if (principal.role !== UserRole.Public) return {};
  const budget = await budgetStore.read(principal.userId);
  if (Result.isError(budget)) {
    // The budget backend is the policy spine's sole fail-open dependency.
    console.warn("notion budget lookup unavailable", serializeError(budget.error));
    return {};
  }
  return { budget: budget.value };
}

function upstreamFailure(cause: unknown, operation: string) {
  const status = httpStatusOf(cause);
  if (status === 429) return new RateLimited({ service: "Notion", retryAfterMs: 1_000 });
  if (status !== undefined && status >= 500) {
    return new Transient({ operation, detail: String(cause) });
  }
  return new UpstreamError({
    service: "Notion",
    status: status ?? 500,
    detail: cause instanceof Error ? cause.message : String(cause),
  });
}

function denied(required: string, actual: string, subject: string) {
  return { ok: false, error: serializeError(new Forbidden({ required, actual, subject })) };
}

function missingIntegration(): string | undefined {
  return env.NOTION_TOKEN === undefined ? "NOTION_TOKEN is not configured" : undefined;
}

async function audit(
  principal: PolicyPrincipal,
  name: NotionToolName,
  input: unknown,
  decision: (typeof AuditDecision)[keyof typeof AuditDecision],
  decidedBy?: string,
): Promise<void> {
  const spec = NOTION_TOOLS[name];
  const recorded = await auditStore.record({
    principal,
    delegate: "notion",
    tool: name,
    risk: spec.access.risk,
    input,
    decision,
    ...(spec.access.reason === undefined ? {} : { reason: spec.access.reason }),
    ...(decidedBy === undefined ? {} : { decidedBy }),
  });
  if (Result.isError(recorded)) {
    // Audit availability must not turn a completed upstream action into a replay.
    console.warn("notion audit append unavailable", serializeError(recorded.error));
  }
}

export async function visibleNotionToolNames(
  current: ApprovalContext["session"]["auth"]["current"],
  candidates: readonly string[],
): Promise<NotionToolName[]> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  const context = await evaluationContext(principal.value);
  return candidates.filter((toolName): toolName is NotionToolName => {
    if (!isNotionToolName(toolName)) return false;
    const decision = decideCapability(principal.value, descriptorForTool(toolName), context);
    return !Result.isError(decision) && decision.value.discover;
  });
}

export async function approvalForNotionTool(
  name: NotionToolName,
  ctx: ApprovalContext,
): Promise<ApprovalStatus> {
  const principal = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(principal)) {
    return { type: "denied", reason: principal.error.message };
  }
  const context = await evaluationContext(principal.value);
  const decision = decideCapability(principal.value, descriptorForTool(name), context);
  if (Result.isError(decision) || !decision.value.execute || decision.value.approve === "deny") {
    await audit(principal.value, name, ctx.toolInput, AuditDecision.Denied);
    return {
      type: "denied",
      reason: Result.isError(decision)
        ? decision.error.message
        : decision.value.denial === "budget"
          ? "Daily AI token budget reached."
          : "Policy denied this Notion action.",
    };
  }
  if (decision.value.approve === Confirmation.None) return "not-applicable";
  if (decision.value.approve === Confirmation.SecondParty) {
    const descriptor = descriptorForTool(name);
    const stored = await approvalPolicyStore.putSecondParty(ctx.session.id, ctx.callId, {
      requesterUserId: principal.value.userId,
      mode: "second-party",
      minApproverRole:
        descriptor.minRole === UserRole.Public ? UserRole.Organizer : descriptor.minRole,
      tool: name,
      risk: descriptor.risk,
    });
    if (Result.isError(stored)) {
      await audit(principal.value, name, ctx.toolInput, AuditDecision.Denied);
      return { type: "denied", reason: "Second-party approval policy could not be persisted." };
    }
    await audit(principal.value, name, ctx.toolInput, AuditDecision.Requested);
    return "user-approval";
  }
  await audit(principal.value, name, ctx.toolInput, AuditDecision.Requested);
  return "user-approval";
}

async function principalForExecution(name: NotionToolName, ctx: ToolContext) {
  const current = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(current)) return undefined;
  const attributes = ctx.session.auth.current?.attributes;
  const descriptor = descriptorForTool(name);
  return resolveExecutionAuthority({
    current: current.value,
    approvalRequesterId: attributes?.approvalRequesterId,
    approvalRequesterMemberRoles: attributes?.approvalRequesterMemberRoles,
    sessionId: ctx.session.id,
    callId: ctx.callId,
    tool: name,
    risk: descriptor.risk,
    requesterMinRole: descriptor.minRole,
    approvalPolicies: approvalPolicyStore,
  });
}

/** Result stays internal; this is the plain JSON Eve boundary. */
export async function executeNotionTool(
  name: NotionToolName,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const authority = await principalForExecution(name, ctx);
  if (authority === undefined) {
    return denied(descriptorForTool(name).minRole, "unauthorized", name);
  }
  const principal = authority.principal;
  const policyContext = await evaluationContext(principal);
  const decision = decideCapability(principal, descriptorForTool(name), policyContext);
  if (Result.isError(decision)) {
    return { ok: false, error: serializeError(decision.error) };
  }
  if (!decision.value.execute) {
    await audit(principal, name, input, AuditDecision.Denied, authority.decidedBy);
    return denied(
      decision.value.denial === "budget"
        ? "available daily token budget"
        : descriptorForTool(name).minRole,
      principal.role,
      name,
    );
  }
  if (authority.decidedBy !== undefined) {
    await audit(principal, name, input, AuditDecision.Approved, authority.decidedBy);
  }
  const missing = missingIntegration();
  if (missing !== undefined) {
    const error = new UpstreamError({ service: "Notion", status: 401, detail: missing });
    await audit(principal, name, input, AuditDecision.Failed, authority.decidedBy);
    return { ok: false, error: serializeError(error) };
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- normalize the catalog union after name lookup
  const spec = NOTION_TOOLS[name] as NotionToolSpec<z.ZodType>;
  const parsed = spec.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        tag: "InvalidInput",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      },
    };
  }
  const result = await Result.tryPromise({
    try: async () => assertToolOutput(await spec.execute(parsed.data, ctx)),
    catch: (cause) => upstreamFailure(cause, `execute Notion tool ${name}`),
  });
  if (Result.isError(result)) {
    await audit(principal, name, input, AuditDecision.Failed, authority.decidedBy);
    return { ok: false, error: serializeError(result.error) };
  }
  await audit(principal, name, input, AuditDecision.Executed, authority.decidedBy);
  return result.value;
}
