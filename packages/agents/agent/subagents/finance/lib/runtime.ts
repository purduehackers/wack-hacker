import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { FINANCE_TOOLS } from "./tool-registry.ts";

export const FINANCE_RUNTIME = createDomainRuntime({
  domain: "finance",
  label: "Finance",
  service: "Finance",
  tools: FINANCE_TOOLS,
  configurationError: () =>
    env.HCB_ORG_SLUG === undefined
      ? new UpstreamError({
          service: "Hack Club Bank",
          status: 401,
          detail: "HCB_ORG_SLUG is not configured",
        })
      : undefined,
});
