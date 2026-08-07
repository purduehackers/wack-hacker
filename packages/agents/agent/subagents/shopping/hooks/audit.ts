import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { descriptorForTool, isShoppingToolName } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool,
  domain: "shopping",
  isToolName: isShoppingToolName,
  label: "Shopping",
});
