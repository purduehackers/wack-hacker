export const DISCORD_GUILD_ID = "772576325897945119";

export const DISCORD_IDS = {
  roles: {
    ADMIN: "1344066433172373656",
    ORGANIZER: "1012751663322382438",
    BISHOP: "1199891815780847647",
    WACKY: "1419119560627458129",
    HACK_NIGHT_PING: "1348025087894355979",
    WELCOMERS: "1381409977775947838",
  },
  channels: {
    SHIP: "904896819165814794",
    CHECKPOINTS: "1052236377338683514",
    HACK_NIGHT: "1020777328172859412",
    LOUNGE: "809628073896443904",
    INTRO: "1182158612454449282",
    // Organizer handoff channel for hack-night batch UUIDs. TODO: confirm id with the user.
    PROJECT_HACK_NIGHT: "1020777328172859412",
  },
  categories: {
    SIGHORSE: "1381412394676518932",
    INTERNAL: new Set([
      "809620177347411998",
      "1290013838955249734",
      "1082077318329143336",
      "938975633885782037",
    ]),
  },
} as const;

/**
 * `InteractionType` and `InteractionResponseType` use `as const` objects
 * instead of `const enum` declarations so they survive bundlers and runtimes
 * that execute TypeScript in strip-only mode (no value inlining). See the
 * `UserRole` pattern in `src/lib/ai/constants.ts` for the same rationale.
 */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type InteractionType = (typeof InteractionType)[keyof typeof InteractionType];

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  /**
   * Sync twin of `DeferredUpdateMessage` — updates the component's message
   * atomically with the interaction response (no defer). Unused: all current
   * component handlers do async work and prefer the deferred variant.
   */
  UpdateMessage: 7,
  ApplicationCommandAutocompleteResult: 8,
  /**
   * Returned to show a modal form in response to a command or component.
   * Unused: no commands currently collect multi-field input via modals.
   */
  Modal: 9,
} as const;

// eslint-disable-next-line @factory/constants-file-organization, @factory/types-file-organization
export type InteractionResponseType =
  (typeof InteractionResponseType)[keyof typeof InteractionResponseType];
