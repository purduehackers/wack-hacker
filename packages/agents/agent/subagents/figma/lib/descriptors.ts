import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { FIGMA_TOOLS, type FigmaToolName } from "./tool-registry.ts";

export function descriptorForTool(name: FigmaToolName): CapabilityDescriptor {
  const access = FIGMA_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const FIGMA_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "figma",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isFigmaToolName(value: string): value is FigmaToolName {
  return Object.hasOwn(FIGMA_TOOLS, value);
}
