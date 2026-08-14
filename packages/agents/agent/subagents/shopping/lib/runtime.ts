import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { SHOPPING_TOOLS } from "./registry.ts";

export const SHOPPING_RUNTIME = createDomainRuntime({
  domain: "shopping",
  label: "Shopping",
  service: "Shopping",
  tools: SHOPPING_TOOLS,
  // Search reaches SerpAPI and the cart reaches Turso. Each tool names the key
  // it cannot run without, so neither list needs restating here.
  credentials: {
    SERPAPI_API_KEY: env.SERPAPI_API_KEY,
    TURSO_DATABASE_URL: env.TURSO_DATABASE_URL,
  },
});
