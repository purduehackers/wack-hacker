import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../lib/env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import {
  projectProviderOutput,
  redactProviderSecrets,
  redactProviderText,
} from "../../../lib/policy/provider-redaction.ts";
import { GITHUB_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
  domain: "github",
  label: "GitHub",
  service: "GitHub",
  tools: GITHUB_TOOLS,
  configurationError: () =>
    env.GITHUB_APP_ID === undefined ||
    env.GITHUB_APP_PRIVATE_KEY === undefined ||
    env.GITHUB_APP_INSTALLATION_ID === undefined ||
    env.GITHUB_ORG === undefined
      ? new UpstreamError({
          service: "GitHub",
          status: 401,
          detail: "GitHub integration is not configured",
        })
      : undefined,
  projectAuditInput: redactProviderSecrets,
  projectOutput: projectProviderOutput,
  sanitizeErrorText: redactProviderText,
});

export const descriptorForTool = runtime.descriptorForTool;
export const isGithubToolName = runtime.isToolName;
export const GITHUB_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleGithubToolNames = runtime.visibleToolNames;
export const approvalForGithubTool = runtime.approvalForTool;
export const executeGithubTool = runtime.executeTool;
