import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { OUTREACH_TOOLS, type OutreachToolName } from "./tool-registry.ts";

export function descriptorForTool(name: OutreachToolName): CapabilityDescriptor {
  const access = OUTREACH_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const OUTREACH_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "outreach",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isOutreachToolName(value: string): value is OutreachToolName {
  return Object.hasOwn(OUTREACH_TOOLS, value);
}
