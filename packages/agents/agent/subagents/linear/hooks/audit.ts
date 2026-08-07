import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { LINEAR_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: LINEAR_RUNTIME.descriptorForTool,
  domain: "linear",
  isToolName: LINEAR_RUNTIME.isToolName,
  label: "Linear",
});
