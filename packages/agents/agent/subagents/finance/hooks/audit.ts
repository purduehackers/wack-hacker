import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { FINANCE_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: FINANCE_RUNTIME.descriptorForTool,
  domain: "finance",
  isToolName: FINANCE_RUNTIME.isToolName,
  label: "Finance",
});
