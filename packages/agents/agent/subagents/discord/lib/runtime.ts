import { RateLimited, Transient, UpstreamError } from "@repo/shared/errors";

import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { DISCORD_TOOLS } from "./tool-registry.ts";

const runtime = createDomainRuntime({
  domain: "discord",
  label: "Discord",
  service: "discord-command-bot",
  tools: DISCORD_TOOLS,
  mapFailure: (cause, operation) => {
    if (
      cause instanceof RateLimited ||
      cause instanceof Transient ||
      cause instanceof UpstreamError
    ) {
      return cause;
    }
    return new UpstreamError({
      service: "discord-command-bot",
      status: 502,
      detail: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  },
});

export const descriptorForTool = runtime.descriptorForTool;
export const isDiscordToolName = runtime.isToolName;
export const DISCORD_SUBAGENT_DESCRIPTOR = runtime.subagentDescriptor;
export const visibleDiscordToolNames = runtime.visibleToolNames;
export const approvalForDiscordTool = runtime.approvalForTool;
export const executeDiscordTool = runtime.executeTool;
