import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { descriptorForTool, isLinearToolName } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool,
  domain: "linear",
  isToolName: isLinearToolName,
  label: "Linear",
});
