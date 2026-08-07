import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { CMS_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
  domain: "cms",
  label: "CMS",
  service: "Payload CMS",
  tools: CMS_TOOLS,
  configurationError: () =>
    env.PAYLOAD_CMS_API_KEY === undefined
      ? new UpstreamError({
          service: "Payload CMS",
          status: 401,
          detail: "PAYLOAD_CMS_API_KEY is not configured",
        })
      : undefined,
});

export const descriptorForTool = runtime.descriptorForTool;
export const isCmsToolName = runtime.isToolName;
export const CMS_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleCmsToolNames = runtime.visibleToolNames;
export const approvalForCmsTool = runtime.approvalForTool;
export const executeCmsTool = runtime.executeTool;
