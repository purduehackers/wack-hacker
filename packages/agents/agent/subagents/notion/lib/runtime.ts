import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { NOTION_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
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

export const descriptorForTool = runtime.descriptorForTool;
export const isNotionToolName = runtime.isToolName;
export const NOTION_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleNotionToolNames = runtime.visibleToolNames;
export const approvalForNotionTool = runtime.approvalForTool;
export const executeNotionTool = runtime.executeTool;
