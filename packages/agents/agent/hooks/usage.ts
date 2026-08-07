import { getRedis } from "@repo/shared/redis";

import { env } from "../lib/env.ts";
import { BudgetStore } from "../lib/policy/budget.ts";
import { defineUsageHook } from "../lib/policy/usage.ts";

const budgets = new BudgetStore(
  getRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
);

export default defineUsageHook(budgets);
