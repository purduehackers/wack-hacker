import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "../../../lib/policy/index.ts";
import { GITHUB_TOOLS, type GithubToolName } from "./tool-registry.ts";

export function descriptorForTool(name: GithubToolName): CapabilityDescriptor {
  const access = GITHUB_TOOLS[name].access;
  return {
    kind: CapabilityKind.Tool,
    name,
    minRole:
      access.minRole ?? (access.risk === RiskLevel.Read ? UserRole.Public : UserRole.Organizer),
    risk: access.risk,
    ...(access.confirm === undefined ? {} : { confirmation: access.confirm }),
  };
}

export const GITHUB_SUBAGENT_DESCRIPTOR = {
  kind: CapabilityKind.Subagent,
  name: "github",
  minRole: UserRole.Organizer,
  risk: RiskLevel.Read,
  confirmation: Confirmation.None,
} as const satisfies CapabilityDescriptor;

export function isGithubToolName(value: string): value is GithubToolName {
  return Object.hasOwn(GITHUB_TOOLS, value);
}
