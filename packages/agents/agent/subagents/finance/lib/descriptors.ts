import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { FINANCE_TOOLS, type FinanceToolName } from "./tool-registry.ts";

export function descriptorForTool(name: FinanceToolName): CapabilityDescriptor {
  const access = FINANCE_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const FINANCE_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "finance",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isFinanceToolName(value: string): value is FinanceToolName {
  return Object.hasOwn(FINANCE_TOOLS, value);
}
