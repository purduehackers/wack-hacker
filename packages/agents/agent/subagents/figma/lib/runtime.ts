import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { FIGMA_TOOLS } from "./tool-registry.ts";

export const FIGMA_RUNTIME = createDomainRuntime({
  domain: "figma",
  label: "Figma",
  service: "Figma",
  tools: FIGMA_TOOLS,
  configurationError: () => {
    if (env.FIGMA_ACCESS_TOKEN === undefined) {
      return new UpstreamError({
        service: "Figma",
        status: 401,
        detail: "FIGMA_ACCESS_TOKEN is not configured",
      });
    }
    if (env.FIGMA_TEAM_ID === undefined) {
      return new UpstreamError({
        service: "Figma",
        status: 401,
        detail: "FIGMA_TEAM_ID is not configured",
      });
    }
    return undefined;
  },
});
