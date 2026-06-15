import type { UserRole } from "@/lib/ai/constants";

import { DISCORD_IDS } from "@/lib/protocol/constants";

/**
 * Map a role tier to the Discord role IDs that resolve to it, mirroring
 * `contextForRole` in the test fixtures so policy/approval gating behaves
 * exactly as in production.
 */
export function roleToMemberRoles(role: UserRole): string[] {
  if (role === "admin") return [DISCORD_IDS.roles.ADMIN];
  if (role === "organizer") return [DISCORD_IDS.roles.ORGANIZER];
  return [];
}
