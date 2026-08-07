import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { descriptorForTool, isGithubToolName } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool,
  domain: "github",
  isToolName: isGithubToolName,
  label: "GitHub",
});
