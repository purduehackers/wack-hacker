import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import { CLOUDFLARE_TOOLS } from "./registry.ts";

export const CLOUDFLARE_RUNTIME = createDomainRuntime({
  domain: "cloudflare",
  label: "Cloudflare",
  service: "Cloudflare",
  tools: CLOUDFLARE_TOOLS,
  configurationError: () => {
    // The account id is only needed by the account-scoped tools, but a
    // deployment with a token and no account id is a misconfiguration either
    // way, and saying so once at the domain boundary beats a confusing failure
    // inside one tool.
    const missing =
      env.CLOUDFLARE_API_TOKEN === undefined
        ? "CLOUDFLARE_API_TOKEN is not configured"
        : env.CLOUDFLARE_ACCOUNT_ID === undefined
          ? "CLOUDFLARE_ACCOUNT_ID is not configured"
          : undefined;
    return missing === undefined
      ? undefined
      : new UpstreamError({ service: "Cloudflare", status: 401, detail: missing });
  },
});
