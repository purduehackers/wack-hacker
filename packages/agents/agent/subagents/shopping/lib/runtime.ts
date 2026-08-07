import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { SHOPPING_TOOLS } from "./tool-registry.ts";

export const SHOPPING_RUNTIME = createDomainRuntime({
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
