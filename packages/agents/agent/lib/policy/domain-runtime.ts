import { AuditDecision } from "@repo/shared/db/enums";
import {
  UserRole,
  roleAtLeast,
  roleFromMemberRoles,
  type UserRole as UserRoleValue,
} from "@repo/shared/discord";
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
import { z } from "zod";

import { assertToolOutput, type JsonValue } from "../serialization.ts";
import type { DomainToolName, DomainToolRegistry, DomainToolSpec } from "./domain-tools.ts";
import { decideCapability } from "./engine.ts";
import { requirePrincipal } from "./principal.ts";
import { getApprovalPolicyStore, getAuditStore, readBudgetContext } from "./stores.ts";
import {
  CapabilityKind,
  Confirmation,
  PolicySource,
  RiskLevel,
  type CapabilityDecision,
  type CapabilityDescriptor,
  type PolicyPrincipal,
} from "./types.ts";

type AuditStore = import("./audit.ts").AuditStore;
type ProviderFailure = RateLimited | Transient | UpstreamError;

export interface DomainRuntimeAdapter<R extends DomainToolRegistry> {
  readonly domain: string;
  readonly label: string;
  readonly service: string;
  readonly tools: R;
  /**
   * Values for the env keys this domain's tools declare in `requires`.
   *
   * Passed explicitly rather than read from `env` by key, so the lookup stays
   * a concrete object the type checker can see rather than an index into the
   * whole environment.
   */
  readonly credentials?: Readonly<Record<string, string | undefined>>;
  readonly configurationError?: (
    name: DomainToolName<R>,
    input: unknown,
  ) => UpstreamError | undefined;
  readonly mapFailure?: (cause: unknown, operation: string) => ProviderFailure;
  readonly projectAuditInput?: (input: unknown, name: DomainToolName<R>) => unknown;
  readonly projectOutput?: (output: unknown, name: DomainToolName<R>) => JsonValue;
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

function hasToolName<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  value: string,
): value is DomainToolName<R> {
  return Object.hasOwn(adapter.tools, value);
}

function toolSpecOf<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
): DomainToolSpec {
  const spec: DomainToolSpec | undefined = adapter.tools[name];
  if (spec === undefined) throw new Error(`Unknown ${adapter.domain} tool: ${name}`);
  return spec;
}

function descriptorOf<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
): CapabilityDescriptor {
  const access = toolSpecOf(adapter, name).access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

interface AuditEntry<R extends DomainToolRegistry> {
  readonly adapter: DomainRuntimeAdapter<R>;
  readonly principal: PolicyPrincipal;
  readonly name: DomainToolName<R>;
  readonly input: unknown;
  readonly decision: AuditDecision;
  readonly decidedBy: string | undefined;
}

async function recordAudit<R extends DomainToolRegistry>(entry: AuditEntry<R>): Promise<void> {
  const { adapter, principal, name, input, decision, decidedBy } = entry;
  const spec = toolSpecOf(adapter, name);
  let store: Pick<AuditStore, "record">;
  try {
    store = await getAuditStore();
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

async function visibleToolNamesOf<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  current: ApprovalContext["session"]["auth"]["current"],
  candidates: readonly string[],
): Promise<DomainToolName<R>[]> {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return [];
  const context = await readBudgetContext(principal.value, adapter.domain);
  return candidates.filter((toolName): toolName is DomainToolName<R> => {
    if (!hasToolName(adapter, toolName)) return false;
    const decision = decideCapability(principal.value, descriptorOf(adapter, toolName), context);
    return !Result.isError(decision) && decision.value.discover;
  });
}

type CapabilityRuling = ReturnType<typeof decideCapability>;

function approvalDenialReason<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  decision: CapabilityRuling,
): string {
  if (Result.isError(decision)) return decision.error.message;
  if (decision.value.denial === "budget") return "Daily AI token budget reached.";
  if (decision.value.denial === "confirmation") {
    return "Scheduled actions cannot run tools that require confirmation.";
  }
  return `Policy denied this ${adapter.label} action.`;
}

async function requestSecondPartyApproval<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
  ctx: ApprovalContext,
  principal: PolicyPrincipal,
): Promise<ApprovalStatus> {
  const descriptor = descriptorOf(adapter, name);
  const stored = await getApprovalPolicyStore().putSecondParty(ctx.session.id, ctx.callId, {
    requesterUserId: principal.userId,
    mode: "second-party",
    minApproverRole: expectedApproverRole(descriptor.minRole),
    tool: name,
    risk: descriptor.risk,
  });
  const entry = { adapter, principal, name, input: ctx.toolInput, decidedBy: undefined };
  if (Result.isError(stored)) {
    await recordAudit({ ...entry, decision: AuditDecision.Denied });
    return { type: "denied", reason: "Second-party approval policy could not be persisted." };
  }
  await recordAudit({ ...entry, decision: AuditDecision.Requested });
  return "user-approval";
}

async function approvalFor<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
  ctx: ApprovalContext,
): Promise<ApprovalStatus> {
  const principal = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(principal)) {
    return { type: "denied", reason: principal.error.message };
  }
  const context = await readBudgetContext(principal.value, adapter.domain);
  const decision = decideCapability(principal.value, descriptorOf(adapter, name), context);
  const entry = {
    adapter,
    principal: principal.value,
    name,
    input: ctx.toolInput,
    decidedBy: undefined,
  };
  if (Result.isError(decision) || !decision.value.execute || decision.value.approve === "deny") {
    await recordAudit({ ...entry, decision: AuditDecision.Denied });
    return { type: "denied", reason: approvalDenialReason(adapter, decision) };
  }
  if (decision.value.approve === Confirmation.None) return "not-applicable";
  if (decision.value.approve === Confirmation.SecondParty) {
    return await requestSecondPartyApproval(adapter, name, ctx, principal.value);
  }
  await recordAudit({ ...entry, decision: AuditDecision.Requested });
  return "user-approval";
}

interface ExecutionAuthority {
  readonly principal: PolicyPrincipal;
  readonly decidedBy?: string;
}

/** The role that may approve for a requester, since nobody self-approves as public. */
function expectedApproverRole(requesterMinRole: UserRoleValue): Exclude<UserRoleValue, "public"> {
  return requesterMinRole === UserRole.Public ? UserRole.Organizer : requesterMinRole;
}

/**
 * Who this call executes as.
 *
 * Without an approval in flight that is simply the caller. With one, the
 * approval is rebound to the requester who owns execution, and every
 * authority-bearing field is re-checked against the durable policy record and
 * the bot's freshly fetched Discord roles before the approver can resume it.
 */
async function executionAuthorityOf<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
  ctx: ToolContext,
): Promise<ExecutionAuthority | undefined> {
  const current = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(current)) return undefined;
  const attributes = ctx.session.auth.current?.attributes;

  const requesterId = z.string().safeParse(attributes?.approvalRequesterId).data;
  if (requesterId === undefined) return { principal: current.value };
  const freshMemberRoles = z
    .array(z.string())
    .safeParse(attributes?.approvalRequesterMemberRoles).data;
  if (freshMemberRoles === undefined) return undefined;

  const descriptor = descriptorOf(adapter, name);
  const policy = await getApprovalPolicyStore().read(ctx.session.id, ctx.callId);
  if (
    Result.isError(policy) ||
    policy.value === undefined ||
    policy.value.requesterUserId !== requesterId ||
    policy.value.tool !== name ||
    policy.value.risk !== descriptor.risk ||
    policy.value.minApproverRole !== expectedApproverRole(descriptor.minRole) ||
    current.value.userId === requesterId ||
    !roleAtLeast(current.value.role, policy.value.minApproverRole)
  ) {
    return undefined;
  }

  const requesterAccess = roleFromMemberRoles(freshMemberRoles);
  if (!roleAtLeast(requesterAccess, descriptor.minRole)) return undefined;
  return {
    principal: { userId: requesterId, role: requesterAccess, source: PolicySource.Chat },
    decidedBy: current.value.userId,
  };
}

/** The denial subject reported to the model when policy refuses execution. */
function executionDenialSubject<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
  denial: CapabilityDecision["denial"],
): string {
  if (denial === "confirmation") return "a confirmation-free scheduled action";
  if (denial === "budget") return "available daily token budget";
  return descriptorOf(adapter, name).minRole;
}

/** Runs the provider call itself, mapping any thrown cause onto a provider failure. */
async function runToolExecution<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  spec: DomainToolSpec,
  name: DomainToolName<R>,
  parsedInput: unknown,
  ctx: ToolContext,
) {
  const operation = `execute ${adapter.label} tool ${name}`;
  return await Result.tryPromise({
    try: async () => {
      const output = await spec.execute(parsedInput, ctx);
      return adapter.projectOutput === undefined
        ? assertToolOutput(output)
        : adapter.projectOutput(output, name);
    },
    catch: (cause) =>
      adapter.mapFailure?.(cause, operation) ??
      standardFailure(adapter.service, cause, operation, adapter.sanitizeErrorText ?? String),
  });
}

/** Result stays internal; this is the plain JSON Eve boundary. */
async function executeToolFor<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const authority = await executionAuthorityOf(adapter, name, ctx);
  if (authority === undefined) {
    return denied(descriptorOf(adapter, name).minRole, "unauthorized", name);
  }
  const principal = authority.principal;
  const entry = { adapter, principal, name, input, decidedBy: authority.decidedBy };
  const policyContext = await readBudgetContext(principal, adapter.domain);
  const decision = decideCapability(principal, descriptorOf(adapter, name), policyContext);
  if (Result.isError(decision)) {
    return { ok: false, error: serializeError(decision.error) };
  }
  if (!decision.value.execute || decision.value.approve === "deny") {
    await recordAudit({ ...entry, decision: AuditDecision.Denied });
    return denied(
      executionDenialSubject(adapter, name, decision.value.denial),
      principal.role,
      name,
    );
  }
  if (authority.decidedBy !== undefined) {
    await recordAudit({ ...entry, decision: AuditDecision.Approved });
  }

  const configurationError =
    missingCredential(adapter, name) ?? adapter.configurationError?.(name, input);
  if (configurationError !== undefined) {
    await recordAudit({ ...entry, decision: AuditDecision.Failed });
    return { ok: false, error: serializeError(configurationError) };
  }

  const spec = toolSpecOf(adapter, name);
  const parsed = spec.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { tag: "InvalidInput", message: z.prettifyError(parsed.error) },
    };
  }
  const result = await runToolExecution(adapter, spec, name, parsed.data, ctx);
  if (Result.isError(result)) {
    await recordAudit({ ...entry, decision: AuditDecision.Failed });
    return { ok: false, error: serializeError(result.error) };
  }
  await recordAudit({ ...entry, decision: AuditDecision.Executed });
  return result.value;
}

/**
 * The error for a tool whose declared `requires` key is absent from the
 * environment the domain supplied.
 *
 * Checked before the domain's own `configurationError`, so a domain keeps the
 * hook only for conditions a single env key cannot express.
 */
function missingCredential<R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
  name: DomainToolName<R>,
): UpstreamError | undefined {
  const declared = toolSpecOf(adapter, name).requires;
  if (declared === undefined) return undefined;
  const required = Array.isArray(declared) ? declared : [declared];
  const missing = required.filter((key) => {
    const value = adapter.credentials?.[key];
    return value === undefined || value === "";
  });
  if (missing.length === 0) return undefined;
  return new UpstreamError({
    service: adapter.service,
    status: 401,
    detail: `${missing.join(" and ")} is not configured`,
  });
}

export function createDomainRuntime<const R extends DomainToolRegistry>(
  adapter: DomainRuntimeAdapter<R>,
) {
  type Name = DomainToolName<R>;

  const subagentDescriptor = {
    kind: CapabilityKind.Subagent,
    name: adapter.domain,
    minRole: UserRole.Organizer,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  } as const satisfies CapabilityDescriptor;

  return {
    approvalForTool: (name: Name, ctx: ApprovalContext): Promise<ApprovalStatus> =>
      approvalFor(adapter, name, ctx),
    descriptorForTool: (name: Name): CapabilityDescriptor => descriptorOf(adapter, name),
    executeTool: (name: Name, input: unknown, ctx: ToolContext): Promise<unknown> =>
      executeToolFor(adapter, name, input, ctx),
    isToolName: (value: string): value is Name => hasToolName(adapter, value),
    subagentDescriptor,
    visibleToolNames: (
      current: ApprovalContext["session"]["auth"]["current"],
      candidates: readonly string[],
    ): Promise<Name[]> => visibleToolNamesOf(adapter, current, candidates),
  } as const;
}
