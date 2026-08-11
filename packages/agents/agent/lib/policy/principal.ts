import { UserRole, isUserRole, roleFromMemberRoles } from "@repo/shared/discord";
import { Unauthenticated } from "@repo/shared/errors";
import { fromNullable, Result } from "@repo/shared/result";
import type { SessionAuthContext } from "eve/context";
import { z } from "zod";

import { PolicySource, type AuthAttribute, type PolicyPrincipal } from "./types.ts";

const stringArraySchema = z.array(z.string());

function stringArray(value: AuthAttribute | undefined): readonly string[] | undefined {
  return stringArraySchema.safeParse(value).data;
}

/**
 * The sole conversion from Eve's nullable `auth.current` into project policy data.
 * Role is re-derived for every resolver/call. Raw Discord roles win when present;
 * a validated asserted role is only the fallback for non-Discord/scheduled adapters.
 */
export function requirePrincipal(
  current: SessionAuthContext | null | undefined,
): Result<PolicyPrincipal, Unauthenticated> {
  const present = fromNullable(
    current,
    () => new Unauthenticated({ reason: "the current Eve delivery has no principal" }),
  );
  if (Result.isError(present)) return present;

  const attributes = present.value.attributes;
  const memberRoles = stringArray(attributes.memberRoles);
  const assertedRole = attributes.role;
  const role =
    memberRoles === undefined
      ? isUserRole(assertedRole)
        ? assertedRole
        : UserRole.Public
      : roleFromMemberRoles(memberRoles);

  // A scheduled delivery gets exactly the freshly asserted/re-derived role. It
  // never falls back to initiator auth or a stored session role.
  const source =
    attributes.source === PolicySource.Scheduled ? PolicySource.Scheduled : PolicySource.Chat;

  return Result.ok({ userId: present.value.principalId, role, source });
}
