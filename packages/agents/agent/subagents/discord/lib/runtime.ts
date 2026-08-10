import { RateLimited, Transient, UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { DISCORD_TOOLS } from "./registry.ts";

export const DISCORD_RUNTIME = createDomainRuntime({
  domain: "discord",
  label: "Discord",
  service: "Discord",
  tools: DISCORD_TOOLS,
  configurationError: () =>
    env.DISCORD_BOT_TOKEN === undefined
      ? new UpstreamError({
          service: "Discord",
          status: 401,
          detail: "DISCORD_BOT_TOKEN is not configured",
        })
      : undefined,
  mapFailure: (cause, operation) => {
    if (
      cause instanceof RateLimited ||
      cause instanceof Transient ||
      cause instanceof UpstreamError
    ) {
      return cause;
    }
    return new UpstreamError({
      service: "Discord",
      status: 502,
      detail: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  },
});
