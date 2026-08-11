import { UserRole } from "@repo/shared/discord";

import {
  CapabilityKind,
  Confirmation,
  RiskLevel,
  type CapabilityDescriptor,
} from "./policy/types.ts";

export const CORE_TOOL_DESCRIPTORS = {
  documentation: {
    kind: CapabilityKind.Tool,
    name: "documentation",
    minRole: UserRole.Public,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  },
  web_search: {
    kind: CapabilityKind.Tool,
    name: "web_search",
    minRole: UserRole.Public,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  },
  resolve_organizer: {
    kind: CapabilityKind.Tool,
    name: "resolve_organizer",
    minRole: UserRole.Public,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  },
  list_audit_log: {
    kind: CapabilityKind.Tool,
    name: "list_audit_log",
    minRole: UserRole.Admin,
    risk: RiskLevel.Read,
    confirmation: Confirmation.None,
  },
} as const satisfies Record<string, CapabilityDescriptor>;

export type CoreToolName = keyof typeof CORE_TOOL_DESCRIPTORS;
