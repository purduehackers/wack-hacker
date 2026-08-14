/**
 * Discord snowflakes for the Purdue Hackers guild.
 *
 * The bot serves exactly one guild, so these are compile-time constants rather
 * than configuration. If someone recreates a role or channel upstream, change
 * it here — there is no runtime lookup to fall back on.
 *
 * Deliberately *not* carried over from the prior implementation: the `BISHOP` and
 * `WELCOMERS` roles, the `LOUNGE` and `INTRO` channels, and the `SIGHORSE`
 * category. All five had no references there — vestiges of removed features —
 * and porting them would imply behaviour that does not exist.
 */
export const DISCORD_GUILD_ID = "772576325897945119";

export const DISCORD_IDS = {
  roles: {
    ADMIN: "1344066433172373656",
    ORGANIZER: "1012751663322382438",
    /** The `praise` handler grants this role, which unlocks celebration reactions. */
    WACKY: "1419119560627458129",
    /** Pinged by the weekly hack-night announcement. */
    HACK_NIGHT_PING: "1348025087894355979",
  },
  channels: {
    /** Ships must carry a URL or attachment. The bot removes text-only posts. */
    SHIP: "904896819165814794",
    CHECKPOINTS: "1052236377338683514",
    /** The audit feed mirrors every audited agent action here, one embed per decision. */
    AGENT_AUDIT: "1537154519182344302",
    HACK_NIGHT: "1020777328172859412",
  },
  categories: {
    /**
     * Messages under these categories are never mirrored to the public
     * dashboard. A `Set` because the dashboard handler tests membership on
     * every message.
     */
    INTERNAL: new Set([
      "809620177347411998",
      "1290013838955249734",
      "1082077318329143336",
      "938975633885782037",
    ]),
  },
} as const;
