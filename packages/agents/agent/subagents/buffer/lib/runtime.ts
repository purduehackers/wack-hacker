import { env } from "../../../env.ts";
import { createDomainRuntime } from "../../../lib/policy/domain-runtime.ts";
import {
  projectProviderOutput,
  redactProviderText,
} from "../../../lib/policy/provider-redaction.ts";
import { BUFFER_TOOLS } from "./registry.ts";

export const BUFFER_RUNTIME = createDomainRuntime({
  domain: "buffer",
  label: "Buffer",
  service: "Buffer",
  tools: BUFFER_TOOLS,
  credentials: {
    BUFFER_API_KEY: env.BUFFER_API_KEY,
    BUFFER_ORGANIZATION_IDS: env.BUFFER_ORGANIZATION_IDS,
  },
  projectOutput: projectProviderOutput,
  sanitizeErrorText: redactProviderText,
});
