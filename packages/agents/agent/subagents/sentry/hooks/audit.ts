import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { SENTRY_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: SENTRY_RUNTIME.descriptorForTool,
  domain: "sentry",
  isToolName: SENTRY_RUNTIME.isToolName,
  label: "Sentry",
  redactInput: true,
});
