import { UserRole } from "@repo/shared/discord";
import { serializeError } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";

import { env, tursoConfig } from "../../env.ts";
import { ApprovalPolicyStore } from "./approval-record.ts";
import type { AuditStore } from "./audit.ts";
import { BudgetStore } from "./budget.ts";
import type { PolicyEvaluationContext, PolicyPrincipal } from "./types.ts";

let redisStores:
  | {
      readonly approval: ApprovalPolicyStore;
      readonly budget: BudgetStore;
    }
  | undefined;
let auditStore: Promise<AuditStore> | undefined;

function stores() {
  if (redisStores !== undefined) return redisStores;
  const redis = getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  redisStores = {
    approval: new ApprovalPolicyStore(redis),
    budget: new BudgetStore(redis),
  };
  return redisStores;
}

export function getApprovalPolicyStore(): ApprovalPolicyStore {
  return stores().approval;
}

export function getBudgetStore(): BudgetStore {
  return stores().budget;
}

/** Defer libSQL until an action needs an audit row. */
export function getAuditStore(): Promise<AuditStore> {
  auditStore ??= import("./audit.ts").then(({ AuditStore }) => new AuditStore(tursoConfig()));
  return auditStore;
}

/**
 * The budget half of a policy evaluation context, read fail-open.
 *
 * Two rules live here rather than at each call site. Only `public` principals
 * are budgeted, so a higher role skips the Redis round trip entirely — the
 * engine's `withinBudget` returns true for them regardless of what was read.
 * And the budget backend is the policy spine's sole fail-open dependency: an
 * unavailable store yields an empty context, never a denial.
 */
export async function readBudgetContext(
  principal: PolicyPrincipal,
  label: string,
): Promise<PolicyEvaluationContext> {
  if (principal.role !== UserRole.Public) return {};
  const budget = await getBudgetStore().read(principal.userId);
  if (Result.isError(budget)) {
    console.warn(`${label} budget lookup unavailable`, serializeError(budget.error));
    return {};
  }
  return { budget: budget.value };
}
