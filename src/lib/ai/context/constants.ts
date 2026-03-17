export const ORGANIZER_ROLE_ID = "1012751663322382438";
export const DIVISION_LEAD_ROLE_ID = "1344066433172373656";

/** Access tier derived from Discord guild member roles. */
export const DiscordRole = {
  Organizer: "organizer",
  DivisionLead: "division-lead",
  Public: "public",
} as const;
