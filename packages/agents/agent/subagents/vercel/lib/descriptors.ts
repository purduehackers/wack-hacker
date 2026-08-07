import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { VERCEL_TOOLS, type VercelToolName } from "./tool-registry.ts";

export function descriptorForTool(name: VercelToolName): CapabilityDescriptor {
  const access = VERCEL_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const VERCEL_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "vercel",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isVercelToolName(value: string): value is VercelToolName {
  return Object.hasOwn(VERCEL_TOOLS, value);
}
