import { UserRole } from "@repo/shared/discord";
import {
  Forbidden,
  RateLimited,
  Transient,
  UpstreamError,
  httpStatusOf,
  serializeError,
} from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { ApprovalContext, ApprovalStatus, ToolContext } from "eve/tools";

import { assertToolOutput } from "../core/serialization.ts";
import type { ApprovalPolicyStore } from "./approval-record.ts";
import type { BudgetStore } from "./budget.ts";
import type { DomainToolName, DomainToolRegistry, DomainToolSpec } from "./domain-tools.ts";
import { decideCapability } from "./engine.ts";
import { resolveExecutionAuthority } from "./execution-authority.ts";
import { requirePrincipal } from "./principal.ts";
import { getApprovalPolicyStore, getAuditStore, getBudgetStore } from "./stores.ts";
import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
  type PolicyEvaluationContext,
  type PolicyPrincipal,
} from "./types.ts";

type AuditDecisionValues = typeof import("@repo/shared/db").AuditDecision;
const AUDIT_DECISIONS = {
  Requested: "requested",
  Approved: "approved",
  Denied: "denied",
  Executed: "executed",
  Failed: "failed",
} as const satisfies Pick<
  AuditDecisionValues,
  "Requested" | "Approved" | "Denied" | "Executed" | "Failed"
>;
type AuditDecision = (typeof AUDIT_DECISIONS)[keyof typeof AUDIT_DECISIONS];
type AuditStore = import("./audit.ts").AuditStore;
type ProviderFailure = RateLimited | Transient | UpstreamError;

export interface DomainRuntimeDependencies {
  readonly approval: Pick<ApprovalPolicyStore, "putSecondParty" | "read">;
  readonly audit: Pick<AuditStore, "record">;
  readonly budget: Pick<BudgetStore, "read">;
}

export interface DomainRuntimeAdapter<R extends DomainToolRegistry> {
  readonly domain: string;
  readonly label: string;
  readonly service: string;
  readonly tools: R;
  readonly configurationError?: (
    name: DomainToolName<R>,
    input: unknown,
  ) => UpstreamError | undefined;
  readonly mapFailure?: (cause: unknown, operation: string) => ProviderFailure;
  readonly projectAuditInput?: (input: unknown, name: DomainToolName<R>) => unknown;
  readonly projectOutput?: (output: unknown, name: DomainToolName<R>) => unknown;
  readonly sanitizeErrorText?: (text: string) => string;
}

function standardFailure(
  service: string,
  cause: unknown,
  operation: string,
  sanitize: (text: string) => string,
): ProviderFailure {
  const status = httpStatusOf(cause);
  if (status === 429) return new RateLimited({ service, retryAfterMs: 1_000 });
  if (status !== undefined && status >= 500) {
    return new Transient({ operation, detail: sanitize(String(cause)) });
  }
  return new UpstreamError({
    service,
    status: status ?? 500,
    detail: sanitize(cause instanceof Error ? cause.message : String(cause)),
  });
}

function denied(required: string, actual: string, subject: string) {
  return { ok: false, error: serializeError(new Forbidden({ required, actual, subject })) };
}

// oxlint-disable-next-line oxclippy/too-many-lines -- authorization, approval, execution, and audit order stay in one reviewable policy closure.
export function createDomainRuntime<const R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  dependencies?: DomainRuntimeDependencies,
) {
  type Name = DomainToolName<R>;

  function isToolName(value: string): value is Name {
    return Object.hasOwn(adapter.tools, value);
  }

  function toolSpec(name: Name): DomainToolSpec {
    const spec: DomainToolSpec | undefined = adapter.tools[name];
    if (spec === undefined) throw new Error(`Unknown ${adapter.domain} tool: ${name}`);
    return spec;
  }

  function descriptorForTool(name: Name): CapabilityDescriptor {
    const access = toolSpec(name).access;
    return {
      kind: CapabilityKind.Tool,
      name,
      minRole:
        access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
      risk: access.risk,
      ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
    };
  }

  const subagentDescriptor = {
    kind: CapabilityKind.Subagent,
    name: adapter.domain,
    minRole: UserRole.Organizer,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  } as const satisfies CapabilityDescriptor;

  async function evaluationContext(principal: PolicyPrincipal): Promise<PolicyEvaluationContext> {
    if (principal.role !== UserRole.Public) return {};
    const budget = await (dependencies?.budget ?? getBudgetStore()).read(principal.userId);
    if (Result.isError(budget)) {
      // The budget backend is the policy spine's sole fail-open dependency.
      console.warn(`${adapter.domain} budget lookup unavailable`, serializeError(budget.error));
      return {};
    }
    return { budget: budget.value };
  }

  async function audit(
    principal: PolicyPrincipal,
    name: Name,
    input: unknown,
    decision: AuditDecision,
    decidedBy?: string,
  ): Promise<void> {
    const spec = toolSpec(name);
    let store: Pick<AuditStore, "record">;
    try {
      store = dependencies?.audit ?? (await getAuditStore());
    } catch (cause) {
      console.warn(`${adapter.domain} audit store unavailable`, cause);
      return;
    }
    const recorded = await store.record({
      principal,
      delegate: adapter.domain,
      tool: name,
      risk: spec.access.risk,
      input: adapter.projectAuditInput?.(input, name) ?? input,
      decision,
      ...(spec.access.reason === undefined ? {} : { reason: spec.access.reason }),
      ...(decidedBy === undefined ? {} : { decidedBy }),
    });
    if (Result.isError(recorded)) {
      // Audit availability must not turn a completed upstream action into a replay.
      console.warn(`${adapter.domain} audit append unavailable`, serializeError(recorded.error));
    }
  }

  async function visibleToolNames(
    current: ApprovalContext["session"]["auth"]["current"],
    candidates: readonly string[],
  ): Promise<Name[]> {
    const principal = requirePrincipal(current);
    if (Result.isError(principal)) return [];
    const context = await evaluationContext(principal.value);
    return candidates.filter((toolName): toolName is Name => {
      if (!isToolName(toolName)) return false;
      const decision = decideCapability(principal.value, descriptorForTool(toolName), context);
      return !Result.isError(decision) && decision.value.discover;
    });
  }

  async function approvalForTool(name: Name, ctx: ApprovalContext): Promise<ApprovalStatus> {
    const principal = requirePrincipal(ctx.session.auth.current);
    if (Result.isError(principal)) {
      return { type: "denied", reason: principal.error.message };
    }
    const context = await evaluationContext(principal.value);
    const decision = decideCapability(principal.value, descriptorForTool(name), context);
    if (Result.isError(decision) || !decision.value.execute || decision.value.approve === "deny") {
      await audit(principal.value, name, ctx.toolInput, AUDIT_DECISIONS.Denied);
      return {
        type: "denied",
        reason: Result.isError(decision)
          ? decision.error.message
          : decision.value.denial === "budget"
            ? "Daily AI token budget reached."
            : decision.value.denial === "confirmation"
              ? "Scheduled actions cannot run tools that require confirmation."
              : `Policy denied this ${adapter.label} action.`,
      };
    }
    if (decision.value.approve === Confirmation.None) return "not-applicable";
    if (decision.value.approve === Confirmation.SecondParty) {
      const descriptor = descriptorForTool(name);
      const stored = await (dependencies?.approval ?? getApprovalPolicyStore()).putSecondParty(
        ctx.session.id,
        ctx.callId,
        {
          requesterUserId: principal.value.userId,
          mode: "second-party",
          minApproverRole:
            descriptor.minRole === UserRole.Public ? UserRole.Organizer : descriptor.minRole,
          tool: name,
          risk: descriptor.risk,
        },
      );
      if (Result.isError(stored)) {
        await audit(principal.value, name, ctx.toolInput, AUDIT_DECISIONS.Denied);
        return { type: "denied", reason: "Second-party approval policy could not be persisted." };
      }
      await audit(principal.value, name, ctx.toolInput, AUDIT_DECISIONS.Requested);
      return "user-approval";
    }
    await audit(principal.value, name, ctx.toolInput, AUDIT_DECISIONS.Requested);
    return "user-approval";
  }

  async function principalForExecution(name: Name, ctx: ToolContext) {
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
      approvalPolicies: dependencies?.approval ?? getApprovalPolicyStore(),
    });
  }

  /** Result stays internal; this is the plain JSON Eve boundary. */
  async function executeTool(name: Name, input: unknown, ctx: ToolContext): Promise<unknown> {
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
    if (!decision.value.execute || decision.value.approve === "deny") {
      await audit(principal, name, input, AUDIT_DECISIONS.Denied, authority.decidedBy);
      return denied(
        decision.value.denial === "confirmation"
          ? "a confirmation-free scheduled action"
          : decision.value.denial === "budget"
            ? "available daily token budget"
            : descriptorForTool(name).minRole,
        principal.role,
        name,
      );
    }
    if (authority.decidedBy !== undefined) {
      await audit(principal, name, input, AUDIT_DECISIONS.Approved, authority.decidedBy);
    }

    const configurationError = adapter.configurationError?.(name, input);
    if (configurationError !== undefined) {
      await audit(principal, name, input, AUDIT_DECISIONS.Failed, authority.decidedBy);
      return { ok: false, error: serializeError(configurationError) };
    }

    const spec = toolSpec(name);
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
    const operation = `execute ${adapter.label} tool ${name}`;
    const result = await Result.tryPromise({
      try: async () => {
        const output = await spec.execute(parsed.data, ctx);
        return adapter.projectOutput === undefined
          ? assertToolOutput(output)
          : adapter.projectOutput(output, name);
      },
      catch: (cause) =>
        adapter.mapFailure?.(cause, operation) ??
        standardFailure(adapter.service, cause, operation, adapter.sanitizeErrorText ?? String),
    });
    if (Result.isError(result)) {
      await audit(principal, name, input, AUDIT_DECISIONS.Failed, authority.decidedBy);
      return { ok: false, error: serializeError(result.error) };
    }
    await audit(principal, name, input, AUDIT_DECISIONS.Executed, authority.decidedBy);
    return result.value;
  }

  return {
    approvalForTool,
    descriptorForTool,
    executeTool,
    isToolName,
    subagentDescriptor,
    visibleToolNames,
  } as const;
}
