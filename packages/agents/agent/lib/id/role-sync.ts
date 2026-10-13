/**
 * Mirrors Purdue Hackers ID roles onto Discord roles.
 *
 * ID is the source of truth for who is an organizer or admin. This module owns
 * exactly two Discord roles, `ORGANIZER` and `ADMIN`; every other role a member
 * holds is left untouched, so a manually granted role is never stripped by a
 * sync.
 *
 * Each sync writes the *whole* desired state rather than replaying the delta, so
 * applying the same event twice is harmless. What is not harmless is applying
 * an *older* event after a newer one — ID retries a failed delivery with
 * backoff, so a demotion that failed once can arrive after the promotion that
 * followed it. A per-account high-water mark in Redis drops anything older than
 * what was last applied.
 */

import { DiscordAPIError, type RouteLike } from "@discordjs/rest";
import { DISCORD_GUILD_ID, DISCORD_IDS } from "@repo/shared/discord";
import { RESTJSONErrorCodes, Routes } from "discord-api-types/v10";
import { z } from "zod";

import { discordSnowflake } from "../schema.ts";
import type { IdRole } from "./webhook.ts";

const AUDIT_REASON = "Synced from Purdue Hackers ID";

/** The Discord roles this sync owns, and the ID role that grants each. */
const MANAGED: readonly { readonly discordRole: string; readonly grantedBy: IdRole }[] = [
  { discordRole: DISCORD_IDS.roles.ORGANIZER, grantedBy: "organizer" },
  { discordRole: DISCORD_IDS.roles.ADMIN, grantedBy: "admin" },
];

export interface RoleChanges {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/**
 * The managed roles to add and remove so `current` matches `idRoles`.
 *
 * `idRoles` is ID's *granted* set, which already expands `admin` to include
 * `organizer`, so an ID admin holds both Discord roles.
 */
export function roleChanges(current: readonly string[], idRoles: readonly IdRole[]): RoleChanges {
  const held = new Set(current);
  const granted = new Set(idRoles);
  const add: string[] = [];
  const remove: string[] = [];
  for (const { discordRole, grantedBy } of MANAGED) {
    const wanted = granted.has(grantedBy);
    if (wanted && !held.has(discordRole)) add.push(discordRole);
    if (!wanted && held.has(discordRole)) remove.push(discordRole);
  }
  return { add, remove };
}

export type SyncOutcome =
  | { readonly status: "applied"; readonly changes: RoleChanges }
  | { readonly status: "no-discord" }
  | { readonly status: "stale" }
  | { readonly status: "not-in-guild" };

/**
 * Compare-and-set on the high-water mark. Equal is accepted, so a retry of the
 * event that set the mark — whose Discord write failed — can still land.
 */
const ADVANCE = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local incoming = tonumber(ARGV[1])
if incoming < current then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return 1
`;

/** Comfortably outlives ID's retry schedule, whose delays sum to about 28 hours. */
const MARK_TTL_SECONDS = 7 * 24 * 60 * 60;

function markKey(discordId: string): string {
  return `id-role-sync:v1:${DISCORD_GUILD_ID}:${discordId}`;
}

/**
 * Discord's answers for "there is nobody here to sync": not in the server, or
 * an account that no longer exists. Retrying either can never succeed.
 */
const GONE = new Set<number | string>([
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownUser,
]);

/** Only the field the diff reads; Discord's member object carries much more. */
const memberSchema = z.object({ roles: z.array(discordSnowflake) });

/** The three member-role calls this module makes; `REST` from `@discordjs/rest` satisfies it. */
export interface RoleRest {
  get(route: RouteLike): Promise<unknown>;
  put(route: RouteLike, options: { readonly reason: string }): Promise<unknown>;
  delete(route: RouteLike, options: { readonly reason: string }): Promise<unknown>;
}

/** The one Redis command this module issues; `RedisClient` satisfies it. */
export interface MarkStore {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export interface RoleSyncDeps {
  readonly rest: RoleRest;
  readonly redis: MarkStore;
}

export async function syncDiscordRoles(
  deps: RoleSyncDeps,
  input: {
    readonly discordId: string;
    readonly idRoles: readonly IdRole[];
    /** ID's envelope timestamp: when the change happened, not when it was delivered. */
    readonly occurredAt: Date;
  },
): Promise<SyncOutcome> {
  const advanced = await deps.redis.eval(
    ADVANCE,
    [markKey(input.discordId)],
    [String(input.occurredAt.getTime()), String(MARK_TTL_SECONDS)],
  );
  if (Number(advanced) !== 1) return { status: "stale" };

  let response: unknown;
  try {
    response = await deps.rest.get(Routes.guildMember(DISCORD_GUILD_ID, input.discordId));
  } catch (cause) {
    if (cause instanceof DiscordAPIError && GONE.has(cause.code)) {
      return { status: "not-in-guild" };
    }
    throw cause;
  }

  const member = memberSchema.parse(response);
  const changes = roleChanges(member.roles, input.idRoles);
  for (const role of changes.add) {
    await deps.rest.put(Routes.guildMemberRole(DISCORD_GUILD_ID, input.discordId, role), {
      reason: AUDIT_REASON,
    });
  }
  for (const role of changes.remove) {
    await deps.rest.delete(Routes.guildMemberRole(DISCORD_GUILD_ID, input.discordId, role), {
      reason: AUDIT_REASON,
    });
  }
  return { status: "applied", changes };
}
