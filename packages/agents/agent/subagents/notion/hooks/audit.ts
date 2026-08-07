import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { NOTION_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: NOTION_RUNTIME.descriptorForTool,
  domain: "notion",
  isToolName: NOTION_RUNTIME.isToolName,
  label: "Notion",
});
