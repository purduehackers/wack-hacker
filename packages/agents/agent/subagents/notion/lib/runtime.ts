import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { NOTION_TOOLS } from "./tool-registry.ts";

export const NOTION_RUNTIME = createDomainRuntime({
  domain: "notion",
  label: "Notion",
  service: "Notion",
  tools: NOTION_TOOLS,
  configurationError: () =>
    env.NOTION_TOKEN === undefined
      ? new UpstreamError({
          service: "Notion",
          status: 401,
          detail: "NOTION_TOKEN is not configured",
        })
      : undefined,
});
