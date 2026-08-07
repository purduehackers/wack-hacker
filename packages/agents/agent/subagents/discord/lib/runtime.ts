import { AuditDecision } from "@repo/shared/db";
import { UserRole } from "@repo/shared/discord";
import {
  Forbidden,
  RateLimited,
  Transient,
  UpstreamError,
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
import { descriptorForTool, isDiscordToolName } from "./descriptors.ts";
import { DISCORD_TOOLS, type DiscordToolName } from "./tool-registry.ts";

let initializedStores:
  | {
      readonly budget: BudgetStore;
      readonly approval: ApprovalPolicyStore;
      readonly audit: ReturnType<typeof createAuditStore>;
    }
  | undefined;

function stores() {
  if (initializedStores !== undefined) return initializedStores;
  const redis = getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  initializedStores = {
    budget: new BudgetStore(redis),
    approval: new ApprovalPolicyStore(redis),
    audit: createAuditStore({
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
    }),
  };
  return initializedStores;
}

async function evaluationContext(principal: PolicyPrincipal): Promise<PolicyEvaluationContext> {
  if (principal.role !== UserRole.Public) return {};
  const budget = await stores().budget.read(principal.userId);
  if (Result.isError(budget)) {
    console.warn("discord budget lookup unavailable", serializeError(budget.error));
    return {};
  }
  return { budget: budget.value };
}

function commandFailure(cause: unknown, operation: string) {
  if (cause instanceof RateLimited || cause instanceof Transient || cause instanceof UpstreamError)
    return cause;
  return new UpstreamError({
    service: "discord-command-bot",
    status: 502,
    detail: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });
}

async function audit(
  principal: PolicyPrincipal,
  name: DiscordToolName,
  input: unknown,
  decision: (typeof AuditDecision)[keyof typeof AuditDecision],
  decidedBy?: string,
): Promise<void> {
  const spec = DISCORD_TOOLS[name];
  const recorded = await stores().audit.record({
    principal,
    delegate: "discord",
    tool: name,
    risk: spec.access.risk,
    input,
    decision,
    ...(spec.access.reason === undefined ? {} : { reason: spec.access.reason }),
    ...(decidedBy === undefined ? {} : { decidedBy }),
  });
  if (Result.isError(recorded)) {
    // Audit availability must not turn a completed upstream action into a replay.
    console.warn("discord audit append unavailable", serializeError(recorded.error));
  }
}

export async function visibleDiscordToolNames(
  current: ApprovalContext["session"]["auth"]["current"],
  candidates: readonly string[],
): Promise<DiscordToolName[]> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  const context = await evaluationContext(principal.value);
  return candidates.filter((toolName): toolName is DiscordToolName => {
    if (!isDiscordToolName(toolName)) return false;
    const decision = decideCapability(principal.value, descriptorForTool(toolName), context);
    return !Result.isError(decision) && decision.value.discover;
  });
}

export async function approvalForDiscordTool(
  name: DiscordToolName,
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
          : "Policy denied this Discord action.",
    };
  }
  if (decision.value.approve === Confirmation.None) return "not-applicable";
  if (decision.value.approve === Confirmation.SecondParty) {
    const descriptor = descriptorForTool(name);
    const stored = await stores().approval.putSecondParty(ctx.session.id, ctx.callId, {
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
  }
  await audit(principal.value, name, ctx.toolInput, AuditDecision.Requested);
  return "user-approval";
}

function denied(required: string, actual: string, subject: string) {
  return { ok: false, error: serializeError(new Forbidden({ required, actual, subject })) };
}

async function principalForExecution(name: DiscordToolName, ctx: ToolContext) {
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
    approvalPolicies: stores().approval,
  });
}

/** Result stays internal; this is the plain JSON Eve boundary. */
export async function executeDiscordTool(
  name: DiscordToolName,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const authority = await principalForExecution(name, ctx);
  if (authority === undefined) return denied(descriptorForTool(name).minRole, "unauthorized", name);
  const principal = authority.principal;
  const policyContext = await evaluationContext(principal);
  const decision = decideCapability(principal, descriptorForTool(name), policyContext);
  if (Result.isError(decision)) return { ok: false, error: serializeError(decision.error) };
  if (!decision.value.execute) {
    await audit(principal, name, input, AuditDecision.Denied, authority.decidedBy);
    const error = new Forbidden({
      required:
        decision.value.denial === "budget"
          ? "available daily token budget"
          : descriptorForTool(name).minRole,
      actual: principal.role,
      subject: name,
    });
    return { ok: false, error: serializeError(error) };
  }
  if (authority.decidedBy !== undefined) {
    await audit(principal, name, input, AuditDecision.Approved, authority.decidedBy);
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- normalize the catalog union after validated name lookup.
  const spec = DISCORD_TOOLS[name] as DomainToolSpec<z.ZodType>;
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
    catch: (cause) => commandFailure(cause, `execute Discord tool ${name}`),
  });
  if (Result.isError(result)) {
    await audit(principal, name, input, AuditDecision.Failed, authority.decidedBy);
    return { ok: false, error: serializeError(result.error) };
  }
  await audit(principal, name, input, AuditDecision.Executed, authority.decidedBy);
  return result.value;
}
