import { UpstreamError } from "@repo/shared/errors";

import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import {
  projectProviderOutput,
  redactProviderSecrets,
  redactProviderText,
} from "../../../lib/policy/provider-redaction.ts";
import { SENTRY_TOOLS } from "./registry.ts";

export const SENTRY_RUNTIME = createDomainRuntime({
  domain: "sentry",
  label: "Sentry",
  service: "Sentry",
  tools: SENTRY_TOOLS,
  configurationError: () =>
    env.SENTRY_AUTH_TOKEN === undefined || env.SENTRY_ORG === undefined
      ? new UpstreamError({
          service: "Sentry",
          status: 401,
          detail: "Sentry integration is not configured",
        })
      : undefined,
  projectAuditInput: redactProviderSecrets,
  projectOutput: projectProviderOutput,
  sanitizeErrorText: redactProviderText,
});
