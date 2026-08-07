import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { descriptorForTool, isNotionToolName } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool,
  domain: "notion",
  isToolName: isNotionToolName,
  label: "Notion",
});
