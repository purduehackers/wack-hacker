import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { GITHUB_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: GITHUB_RUNTIME.descriptorForTool,
  domain: "github",
  isToolName: GITHUB_RUNTIME.isToolName,
  label: "GitHub",
});
