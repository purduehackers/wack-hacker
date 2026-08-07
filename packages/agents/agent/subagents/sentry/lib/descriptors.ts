import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { SENTRY_TOOLS, type SentryToolName } from "./tool-registry.ts";

export function descriptorForTool(name: SentryToolName): CapabilityDescriptor {
  const access = SENTRY_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const SENTRY_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "sentry",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isSentryToolName(value: string): value is SentryToolName {
  return Object.hasOwn(SENTRY_TOOLS, value);
}
