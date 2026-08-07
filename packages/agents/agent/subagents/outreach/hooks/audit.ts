import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { OUTREACH_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: OUTREACH_RUNTIME.descriptorForTool,
  domain: "outreach",
  isToolName: OUTREACH_RUNTIME.isToolName,
  label: "Outreach",
});
