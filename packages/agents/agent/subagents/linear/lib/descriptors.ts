import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { LINEAR_TOOLS, type LinearToolName } from "./tool-registry.ts";

export function descriptorForTool(name: LinearToolName): CapabilityDescriptor {
  const access = LINEAR_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const LINEAR_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "linear",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isLinearToolName(value: string): value is LinearToolName {
  return Object.hasOwn(LINEAR_TOOLS, value);
}
