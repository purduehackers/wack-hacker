import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { VERCEL_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: VERCEL_RUNTIME.descriptorForTool,
  domain: "vercel",
  isToolName: VERCEL_RUNTIME.isToolName,
  label: "Vercel",
});
