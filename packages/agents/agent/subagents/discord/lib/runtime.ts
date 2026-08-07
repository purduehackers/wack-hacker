import { RateLimited, Transient, UpstreamError } from "@repo/shared/errors";

import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { DISCORD_TOOLS } from "./tool-registry.ts";

export const DISCORD_RUNTIME = createDomainRuntime({
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
