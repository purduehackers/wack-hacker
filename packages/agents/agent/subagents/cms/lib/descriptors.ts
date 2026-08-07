import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/types.ts";
import { CMS_TOOLS, type CmsToolName } from "./tool-registry.ts";

export function descriptorForTool(name: CmsToolName): CapabilityDescriptor {
  const access = CMS_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const CMS_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "cms",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isCmsToolName(value: string): value is CmsToolName {
  return Object.hasOwn(CMS_TOOLS, value);
}
