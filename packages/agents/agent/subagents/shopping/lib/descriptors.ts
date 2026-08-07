import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { SHOPPING_TOOLS, type ShoppingToolName } from "./tool-registry.ts";

export function descriptorForTool(name: ShoppingToolName): CapabilityDescriptor {
  const access = SHOPPING_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const SHOPPING_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "shopping",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isShoppingToolName(value: string): value is ShoppingToolName {
  return Object.hasOwn(SHOPPING_TOOLS, value);
}
