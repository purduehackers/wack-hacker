/** Access tier derived from Discord guild member roles. */
export const DiscordRole = {
  Organizer: "organizer",
  DivisionLead: "division-lead",
  Public: "public",
} as const;

export type DiscordRole = (typeof DiscordRole)[keyof typeof DiscordRole];
