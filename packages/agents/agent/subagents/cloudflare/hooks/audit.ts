import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { CLOUDFLARE_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: CLOUDFLARE_RUNTIME.descriptorForTool,
  domain: "cloudflare",
  isToolName: CLOUDFLARE_RUNTIME.isToolName,
  label: "Cloudflare",
});
