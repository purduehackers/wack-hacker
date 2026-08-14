/**
 * Role resolution: Discord role snowflakes → an application access tier.
 *
 * This is the root of the whole permission model. The bot reads a member's raw
 * role IDs off a gateway event and asserts the resolved tier to the agent.
 * The agent hangs every capability gate off that tier — which subagents exist,
 * which tools are visible, which sub-skills appear in the menu.
 *
 * Two properties are load-bearing:
 *
 * 1. **Resolution is total.** No roles, an unknown member, a user who left —
 *    every case resolves to `public`. There is no failure mode and therefore no
 *    `Result` here. A role lookup that could fail would turn an outage into a
 *    privilege question, which is exactly wrong.
 *
 * 2. **Every turn resolves roles again, never from a cache.** A follow-up
 *    message from a different person resolves with *their* roles. A scheduled
 *    task re-reads its creator's current roles at fire time, so a de-roled
 *    organizer stops getting organizer-powered runs.
 *
 * `as const` object rather than a TS `enum`: `erasableSyntaxOnly` forbids enums
 * because they emit runtime code. The prior implementation reached the same shape by
 * convention, since its workflow step bundles ran in strip-only type mode.
 */

import { z } from "zod";

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

/**
 * True when `role` sits at or above `minimum` in the tier order. Gates use
 * this instead of equality so an admin passes every organizer check.
 */
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

/**
 * Narrows an untrusted string — a stored snapshot, a wire payload. The schema
 * derives from the tier object rather than restating its members, so a new
 * tier joins the schema the moment its declaration lands.
 */
const userRoleSchema = z.enum(UserRole);

/**
 * Type guard over the tier set for untrusted input. A value that fails the
 * guard drops to `public` at the call site, so bad data can never grant a
 * higher tier.
 */
export function isUserRole(value: unknown): value is UserRole {
  return userRoleSchema.safeParse(value).success;
}
