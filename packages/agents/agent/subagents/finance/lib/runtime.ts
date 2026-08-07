import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { FINANCE_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
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

export const descriptorForTool = runtime.descriptorForTool;
export const isFinanceToolName = runtime.isToolName;
export const FINANCE_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleFinanceToolNames = runtime.visibleToolNames;
export const approvalForFinanceTool = runtime.approvalForTool;
export const executeFinanceTool = runtime.executeTool;
