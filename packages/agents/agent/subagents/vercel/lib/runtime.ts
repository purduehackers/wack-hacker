import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import {
  projectProviderOutput,
  redactProviderSecrets,
  redactProviderText,
} from "../../../lib/policy/provider-redaction.ts";
import { VERCEL_TOOLS } from "./tool-registry.ts";

export const VERCEL_RUNTIME = createDomainRuntime({
  domain: "vercel",
  label: "Vercel",
  service: "Vercel",
  tools: VERCEL_TOOLS,
  configurationError: () =>
    env.VERCEL_API_TOKEN === undefined
      ? new UpstreamError({
          service: "Vercel",
          status: 401,
          detail: "Vercel integration is not configured",
        })
      : undefined,
  projectAuditInput: redactProviderSecrets,
  projectOutput: projectProviderOutput,
  sanitizeErrorText: redactProviderText,
});
