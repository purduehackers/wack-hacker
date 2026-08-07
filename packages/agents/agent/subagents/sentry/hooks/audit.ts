import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { descriptorForTool, isSentryToolName } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool,
  domain: "sentry",
  isToolName: isSentryToolName,
  label: "Sentry",
});
