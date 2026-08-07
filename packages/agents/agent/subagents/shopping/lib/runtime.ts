import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { SHOPPING_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
  domain: "shopping",
  label: "Shopping",
  service: "Shopping",
  tools: SHOPPING_TOOLS,
  configurationError: (name) => {
    const missing =
      name === "search_products"
        ? env.SERPAPI_API_KEY === undefined
          ? "SERPAPI_API_KEY is not configured"
          : undefined
        : typeof env.TURSO_DATABASE_URL !== "string" || env.TURSO_DATABASE_URL.length === 0
          ? "TURSO_DATABASE_URL is not configured"
          : undefined;
    return missing === undefined
      ? undefined
      : new UpstreamError({ service: "Shopping", status: 401, detail: missing });
  },
});

export const descriptorForTool = runtime.descriptorForTool;
export const isShoppingToolName = runtime.isToolName;
export const SHOPPING_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleShoppingToolNames = runtime.visibleToolNames;
export const approvalForShoppingTool = runtime.approvalForTool;
export const executeShoppingTool = runtime.executeTool;
