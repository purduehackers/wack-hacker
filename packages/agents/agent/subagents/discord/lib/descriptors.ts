import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { DISCORD_TOOLS, type DiscordToolName } from "./tool-registry.ts";

export function descriptorForTool(name: DiscordToolName): CapabilityDescriptor {
  const access = DISCORD_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const DISCORD_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "discord",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isDiscordToolName(value: string): value is DiscordToolName {
  return Object.hasOwn(DISCORD_TOOLS, value);
}
