import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { FIGMA_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: FIGMA_RUNTIME.descriptorForTool,
  domain: "figma",
  isToolName: FIGMA_RUNTIME.isToolName,
  label: "Figma",
});
