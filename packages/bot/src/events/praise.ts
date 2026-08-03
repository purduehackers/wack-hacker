/**
 * The WACKY role, granted and revoked by magic words.
 *
 * `wackity hackity praise me` grants it; `wackity hackity go away` takes it back.
 * The role unlocks the celebration reactions in `auto-thread`.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { defineEvent } from "../framework/events.ts";

const PRAISE_PATTERN = /wackity\s+hackity\s+praise\s+me/i;
const DISMISS_PATTERN = /wackity\s+hackity\s+go\s+away/i;

const PARTY_FACE = "\u{1F973}";
const ZIPPER_MOUTH = "\u{1F910}";

export const praise = defineEvent({
  name: "praise",
  kind: "message",
  // Granting a role twice is harmless, but reacting twice is visible noise.
  dedupKey: (message) => message.id,
  handle: async (message) => {
    const granting = PRAISE_PATTERN.test(message.content);
    const revoking = DISMISS_PATTERN.test(message.content);
    if (!granting && !revoking) return Result.ok(undefined);

    const { member } = message;
    // Absent in a DM, or when Discord could not resolve the member. Either way
    // there is no member to give a role to.
    if (!member) return Result.ok(undefined);

    return Result.tryPromise({
      try: async () => {
        if (granting) {
          await member.roles.add(DISCORD_IDS.roles.WACKY);
          await message.react(PARTY_FACE);
        } else {
          await member.roles.remove(DISCORD_IDS.roles.WACKY);
          await message.react(ZIPPER_MOUTH);
        }
        return undefined;
      },
      catch: (cause) =>
        new Transient({
          operation: granting ? "grant wacky role" : "revoke wacky role",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
  },
});
