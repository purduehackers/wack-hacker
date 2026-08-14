/**
 * Reading a caller's roles off an interaction.
 *
 * discord.js hands back one of two shapes depending on whether the guild
 * member was resolvable from cache. A `GuildMember` carries `roles` as a
 * manager with a `cache` collection keyed by role id. A raw
 * `APIInteractionGuildMember` carries `roles` as a plain `string[]`. Both
 * occur in practice, so this module handles both instead of every call site
 * doing it.
 *
 * This module reads roles fresh from the interaction every time. That is what
 * makes a follow-up from a different person evaluate with *their* permissions.
 * It is also why there is no caching layer here to go stale.
 */

import { UserRole, roleFromMemberRoles } from "@repo/shared/discord";
import type { Interaction, Message } from "discord.js";

type WithMember = Pick<Interaction, "member"> | Pick<Message, "member">;

function memberRoleIds(source: WithMember): readonly string[] {
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
