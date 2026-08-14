import {
  Forbidden,
  RateLimited,
  Transient,
  UpstreamError,
  httpStatusOf,
  serializeError,
} from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { SessionAuthContext } from "eve/context";
import type { ToolContext } from "eve/tools";

import { env } from "../../env.ts";
import { CORE_TOOL_DESCRIPTORS, type CoreToolName } from "../descriptors.ts";
import { isGlobalConfigConnectionConfigured } from "../global-config.ts";
import { decideCapability } from "./engine.ts";
import { requirePrincipal } from "./principal.ts";
import { readBudgetContext } from "./stores.ts";

function integrationConfigured(name: CoreToolName): boolean {
  switch (name) {
    case "documentation":
      return env.PHACK_ASK_API_KEY !== undefined;
    case "web_search":
      return env.EXA_API_KEY !== undefined;
    case "resolve_organizer":
      return (
        env.GLOBAL_CONFIG !== undefined && isGlobalConfigConnectionConfigured(env.GLOBAL_CONFIG)
      );
    case "list_audit_log":
      // `env.ts` requires `TURSO_DATABASE_URL`, so the audit log counts as
      // configured whenever the process started at all.
      return true;
  }
}

/** Resolves role-gated discovery from the current Eve delivery on every turn. */
export function isCoreToolVisible(name: CoreToolName, current: SessionAuthContext | null): boolean {
  if (!integrationConfigured(name)) return false;
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return false;
  const decision = decideCapability(principal.value, CORE_TOOL_DESCRIPTORS[name]);
  return !Result.isError(decision) && decision.value.discover;
}

/**
 * The execute-time gate that runs before every core tool touches its
 * integration. A denial comes back as a ready-to-return tool output, so tool
 * bodies never invent their own denial shape. The output names the missing
 * role, the exhausted budget, or the required confirmation. An unconfigured
 * integration denies the same way, with a 503 in the output.
 */
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
    await readBudgetContext(principal.value, "core tool"),
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
        : decision.value.denial === "confirmation"
          ? new Forbidden({
              required: "a confirmation-free scheduled action",
              actual: "confirmation required",
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
