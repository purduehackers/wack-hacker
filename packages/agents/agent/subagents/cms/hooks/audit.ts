import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { CMS_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: CMS_RUNTIME.descriptorForTool,
  domain: "cms",
  isToolName: CMS_RUNTIME.isToolName,
  label: "CMS",
});
