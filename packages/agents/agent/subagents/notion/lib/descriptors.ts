import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { NOTION_TOOLS, type NotionToolName } from "./tool-registry.ts";

export function descriptorForTool(name: NotionToolName): CapabilityDescriptor {
  const access = NOTION_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const NOTION_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "notion",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isNotionToolName(value: string): value is NotionToolName {
  return Object.hasOwn(NOTION_TOOLS, value);
}
