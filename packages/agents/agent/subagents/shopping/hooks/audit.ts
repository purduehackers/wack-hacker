import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { SHOPPING_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: SHOPPING_RUNTIME.descriptorForTool,
  domain: "shopping",
  isToolName: SHOPPING_RUNTIME.isToolName,
  label: "Shopping",
});
