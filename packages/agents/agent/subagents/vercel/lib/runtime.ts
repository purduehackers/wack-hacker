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
import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
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
import { descriptorForTool, isVercelToolName } from "./descriptors.ts";
import { VERCEL_TOOLS, type VercelToolName } from "./tool-registry.ts";

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
    console.warn("vercel budget lookup unavailable", serializeError(budget.error));
    return {};
  }
  return { budget: budget.value };
}

function redactText(value: string): string {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]");
  for (const secret of [env.GITHUB_APP_PRIVATE_KEY, env.SENTRY_AUTH_TOKEN, env.VERCEL_API_TOKEN]) {
    if (secret && secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|dsn)/i;
const VALUE_SECRET_TOOLS = new Set([
  "create_or_update_repo_secret",
  "create_or_update_org_secret",
  "get_project_env_var",
  "create_project_env_vars",
  "edit_project_env_var",
  "create_edge_config_token",
  "create_sdk_key",
]);

function redactSecrets(value: unknown, toolName?: string, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, toolName, seen));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      SENSITIVE_KEY.test(key) ||
      (VALUE_SECRET_TOOLS.has(toolName ?? "") && /^(?:value|key)$/i.test(key))
    ) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactSecrets(entry, toolName, seen);
    }
  }
  return output;
}

function upstreamFailure(cause: unknown, operation: string) {
  const status = httpStatusOf(cause);
  if (status === 429) return new RateLimited({ service: "Vercel", retryAfterMs: 1_000 });
  if (status !== undefined && status >= 500) {
    return new Transient({ operation, detail: redactText(String(cause)) });
  }
  return new UpstreamError({
    service: "Vercel",
    status: status ?? 500,
    detail: redactText(cause instanceof Error ? cause.message : String(cause)),
  });
}

function plainJson(output: unknown, toolName: string): unknown {
  return assertToolOutput(redactSecrets(assertToolOutput(output), toolName));
}

function denied(required: string, actual: string, subject: string) {
  return { ok: false, error: serializeError(new Forbidden({ required, actual, subject })) };
}

async function audit(
  principal: PolicyPrincipal,
  name: VercelToolName,
  input: unknown,
  decision: (typeof AuditDecision)[keyof typeof AuditDecision],
  decidedBy?: string,
): Promise<void> {
  const spec = VERCEL_TOOLS[name];
  const recorded = await auditStore.record({
    principal,
    delegate: "vercel",
    tool: name,
    risk: spec.access.risk,
    input: redactSecrets(input, name),
    decision,
    ...(spec.access.reason === undefined ? {} : { reason: spec.access.reason }),
    ...(decidedBy === undefined ? {} : { decidedBy }),
  });
  if (Result.isError(recorded)) {
    // Audit availability must not turn a completed upstream action into a replay.
    console.warn("vercel audit append unavailable", serializeError(recorded.error));
  }
}

export async function visibleVercelToolNames(
  current: ApprovalContext["session"]["auth"]["current"],
  requestedNames: readonly string[],
): Promise<VercelToolName[]> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  const context = await evaluationContext(principal.value);
  return requestedNames.filter((toolName): toolName is VercelToolName => {
    if (!isVercelToolName(toolName)) return false;
    const decision = decideCapability(principal.value, descriptorForTool(toolName), context);
    return !Result.isError(decision) && decision.value.discover;
  });
}

export async function approvalForVercelTool(
  name: VercelToolName,
  ctx: ApprovalContext,
): Promise<ApprovalStatus> {
  const principal = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(principal)) return { type: "denied", reason: principal.error.message };
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
          : "Policy denied this Vercel action.",
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

async function principalForExecution(name: VercelToolName, ctx: ToolContext) {
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
export async function executeVercelTool(
  name: VercelToolName,
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
  if (Result.isError(decision)) return { ok: false, error: serializeError(decision.error) };
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

  if (env.VERCEL_API_TOKEN === undefined) {
    const error = new UpstreamError({
      service: "Vercel",
      status: 401,
      detail: "Vercel integration is not configured",
    });
    await audit(principal, name, input, AuditDecision.Failed, authority.decidedBy);
    return { ok: false, error: serializeError(error) };
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- normalize the catalog union after name lookup
  const spec = VERCEL_TOOLS[name] as DomainToolSpec<z.ZodType>;
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
    try: async () => plainJson(await spec.execute(parsed.data, ctx), name),
    catch: (cause) => upstreamFailure(cause, `execute Vercel tool ${name}`),
  });
  if (Result.isError(result)) {
    await audit(principal, name, input, AuditDecision.Failed, authority.decidedBy);
    return { ok: false, error: serializeError(result.error) };
  }
  await audit(principal, name, input, AuditDecision.Executed, authority.decidedBy);
  return result.value;
}
