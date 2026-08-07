import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { LINEAR_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
  domain: "linear",
  label: "Linear",
  service: "Linear",
  tools: LINEAR_TOOLS,
  configurationError: () =>
    env.LINEAR_API_KEY === undefined
      ? new UpstreamError({
          service: "Linear",
          status: 401,
          detail: "LINEAR_API_KEY is not configured",
        })
      : undefined,
});

export const descriptorForTool = runtime.descriptorForTool;
export const isLinearToolName = runtime.isToolName;
export const LINEAR_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleLinearToolNames = runtime.visibleToolNames;
export const approvalForLinearTool = runtime.approvalForTool;
export const executeLinearTool = runtime.executeTool;
