import { defineDomainAuditHook } from "../../../lib/policy/domain-audit-hook.ts";
import { DISCORD_RUNTIME } from "../lib/runtime.ts";

export default defineDomainAuditHook({
  descriptorForTool: DISCORD_RUNTIME.descriptorForTool,
  domain: "discord",
  isToolName: DISCORD_RUNTIME.isToolName,
  label: "Discord",
});
