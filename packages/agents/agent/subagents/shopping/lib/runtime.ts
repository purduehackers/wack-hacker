import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { SHOPPING_TOOLS } from "./tool-registry.ts";

/** The cart tools need a real database URL, not merely a declared one. */
const configuredUrl = z.string().min(1);

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
        : configuredUrl.safeParse(env.TURSO_DATABASE_URL).success
          ? undefined
          : "TURSO_DATABASE_URL is not configured";
    return missing === undefined
      ? undefined
      : new UpstreamError({ service: "Shopping", status: 401, detail: missing });
  },
});
