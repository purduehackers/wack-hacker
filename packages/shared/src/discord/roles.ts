/**
 * Role resolution: Discord role snowflakes → an application access tier.
 *
 * This is the root of the whole permission model. The bot reads a member's raw
 * role IDs off a gateway event and asserts the resolved tier to the agent, which
 * hangs every capability gate off it — which subagents exist, which tools are
 * visible, which sub-skills appear in the menu.
 *
 * Two properties are load-bearing:
 *
 * 1. **Resolution is total.** No roles, an unknown member, a user who left —
 *    every case resolves to `public`. There is no failure mode and therefore no
 *    `Result` here; a role lookup that could fail would mean an outage becomes a
 *    privilege question, which is exactly wrong.
 *
 * 2. **It is re-resolved per turn, never cached.** A follow-up message from a
 *    different person is evaluated with *their* roles, and a scheduled task
 *    re-reads its creator's current roles at fire time so a de-roled organizer
 *    stops getting organizer-powered runs.
 *
 * `as const` object rather than a TS `enum`: `erasableSyntaxOnly` forbids enums
 * because they emit runtime code. The legacy app reached the same shape by
 * convention, since its workflow step bundles ran in strip-only type mode.
 */

import { DISCORD_IDS } from "./constants.ts";

export const UserRole = {
  Public: "public",
  Organizer: "organizer",
  Admin: "admin",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Ordered tiers. Higher strictly includes every capability of lower. */
const ROLE_LEVEL: Record<UserRole, number> = {
  [UserRole.Public]: 0,
  [UserRole.Organizer]: 1,
  [UserRole.Admin]: 2,
};

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minimum];
}

/**
 * Highest tier implied by a member's role IDs. Checked most-privileged first so
 * an admin who also holds the organizer role resolves to `admin`.
 */
export function roleFromMemberRoles(memberRoles?: readonly string[]): UserRole {
  if (memberRoles === undefined) return UserRole.Public;
  if (memberRoles.includes(DISCORD_IDS.roles.ADMIN)) return UserRole.Admin;
  if (memberRoles.includes(DISCORD_IDS.roles.ORGANIZER)) return UserRole.Organizer;
  return UserRole.Public;
}

/** Narrows an untrusted string — a stored snapshot, a wire payload. */
export function isUserRole(value: unknown): value is UserRole {
  return value === UserRole.Public || value === UserRole.Organizer || value === UserRole.Admin;
}
