import { getRedis } from "@repo/shared/redis";

import { env } from "../../env.ts";
import { ApprovalPolicyStore } from "./approval-record.ts";
import type { AuditStore } from "./audit.ts";
import { BudgetStore } from "./budget.ts";

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
  auditStore ??= import("./audit.ts").then(({ createAuditStore }) =>
    createAuditStore({
      url: env.TURSO_DATABASE_URL,
      ...(env.TURSO_AUTH_TOKEN === undefined ? {} : { authToken: env.TURSO_AUTH_TOKEN }),
    }),
  );
  return auditStore;
}
