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
import type { SessionAuthContext } from "eve/context";
import type { ToolContext } from "eve/tools";

import { env } from "../env.ts";
import { BudgetStore } from "../policy/budget.ts";
import { decideCapability } from "../policy/engine.ts";
import { requirePrincipal } from "../policy/principal.ts";
import type { PolicyEvaluationContext, PolicyPrincipal } from "../policy/types.ts";
import { CORE_TOOL_DESCRIPTORS, type CoreToolName } from "./descriptors.ts";
import { isEdgeConfigConnectionConfigured } from "./edge-config.ts";

let budgetStore: BudgetStore | undefined;

function integrationConfigured(name: CoreToolName): boolean {
  switch (name) {
    case "documentation":
      return env.PHACK_ASK_API_KEY !== undefined;
    case "web_search":
      return env.EXA_API_KEY !== undefined;
    case "resolve_organizer":
      return env.EDGE_CONFIG !== undefined && isEdgeConfigConnectionConfigured(env.EDGE_CONFIG);
    case "list_audit_log":
      return typeof env.TURSO_DATABASE_URL === "string" && env.TURSO_DATABASE_URL.length > 0;
  }
}

async function evaluationContext(principal: PolicyPrincipal): Promise<PolicyEvaluationContext> {
  if (
    typeof env.UPSTASH_REDIS_REST_URL !== "string" ||
    typeof env.UPSTASH_REDIS_REST_TOKEN !== "string"
  ) {
    return {};
  }
  budgetStore ??= new BudgetStore(
    getRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
  );
  const budget = await budgetStore.read(principal.userId);
  if (Result.isError(budget)) {
    // Budget is the policy spine's sole fail-open dependency.
    console.warn("core tool budget lookup unavailable");
    return {};
  }
  return { budget: budget.value };
}

/** Role-gated discovery is resolved from the current Eve delivery on every turn. */
export function isCoreToolVisible(name: CoreToolName, current: SessionAuthContext | null): boolean {
  if (!integrationConfigured(name)) return false;
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return false;
  const decision = decideCapability(principal.value, CORE_TOOL_DESCRIPTORS[name]);
  return !Result.isError(decision) && decision.value.discover;
}

export async function authorizeCoreTool(name: CoreToolName, ctx: ToolContext) {
  if (!integrationConfigured(name)) {
    return {
      allowed: false,
      output: {
        ok: false,
        error: serializeError(
          new UpstreamError({
            service: name,
            status: 503,
            detail: "integration is not configured",
          }),
        ),
      },
    } as const;
  }

  const principal = requirePrincipal(ctx.session.auth.current);
  if (Result.isError(principal)) {
    return {
      allowed: false,
      output: { ok: false, error: serializeError(principal.error) },
    } as const;
  }
  const decision = decideCapability(
    principal.value,
    CORE_TOOL_DESCRIPTORS[name],
    await evaluationContext(principal.value),
  );
  if (Result.isError(decision)) {
    return {
      allowed: false,
      output: { ok: false, error: serializeError(decision.error) },
    } as const;
  }
  if (!decision.value.execute) {
    const descriptor = CORE_TOOL_DESCRIPTORS[name];
    const error =
      decision.value.denial === "budget"
        ? new Forbidden({
            required: "available daily token budget",
            actual: "exhausted",
            subject: name,
          })
        : new Forbidden({
            required: descriptor.minRole,
            actual: principal.value.role,
            subject: name,
          });
    return { allowed: false, output: { ok: false, error: serializeError(error) } } as const;
  }
  return { allowed: true, principal: principal.value } as const;
}

/** Convert arbitrary upstream throws without echoing URLs, credentials, bodies, or stacks. */
export function coreToolFailure(service: string, cause: unknown) {
  const status = httpStatusOf(cause);
  const error =
    status === 429
      ? new RateLimited({ service, retryAfterMs: 1_000 })
      : status !== undefined && status >= 500
        ? new Transient({ operation: `${service} request`, detail: "upstream unavailable" })
        : new UpstreamError({ service, status: status ?? 500, detail: "request failed" });
  return { ok: false, error: serializeError(error) } as const;
}
