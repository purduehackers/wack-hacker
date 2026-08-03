/**
 * Reading a caller's roles off an interaction.
 *
 * discord.js hands back one of two shapes depending on whether the guild member
 * was resolvable from cache: a `GuildMember`, whose `roles` is a manager with a
 * `cache` collection keyed by role id, or a raw `APIInteractionGuildMember`,
 * whose `roles` is already a `string[]`. Both occur in practice, so both are
 * handled here rather than at every call site.
 *
 * Roles are read fresh from the interaction every time. That is what makes a
 * follow-up from a different person evaluate with *their* permissions, and it is
 * why there is no caching layer here to go stale.
 */

import { UserRole, roleFromMemberRoles } from "@repo/shared/discord";
import type { Interaction, Message } from "discord.js";

type WithMember = Pick<Interaction, "member"> | Pick<Message, "member">;

export function memberRoleIds(source: WithMember): readonly string[] {
  const { member } = source;
  // Absent for a DM, or when Discord could not resolve the member.
  if (!member) return [];

  const { roles } = member;
  if (Array.isArray(roles)) return roles;
  return [...roles.cache.keys()];
}

/** The caller's access tier. Resolves to `public` whenever roles are unknown. */
export function roleOf(source: WithMember): UserRole {
  return roleFromMemberRoles(memberRoleIds(source));
}
