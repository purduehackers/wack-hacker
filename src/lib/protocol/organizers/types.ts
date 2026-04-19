import type { z } from "zod";

import type { ORGANIZER_PLATFORMS, EDITABLE_PLATFORMS } from "./constants.ts";
import type { organizerSchema, organizersSchema } from "./reader.ts";

export type Organizer = z.infer<typeof organizerSchema>;
export type OrganizersMap = z.infer<typeof organizersSchema>;
export type OrganizerPlatform = (typeof ORGANIZER_PLATFORMS)[number];
export type EditablePlatform = (typeof EDITABLE_PLATFORMS)[number];

/** An organizer record flattened with the Discord ID (the map key) under `discord`. */
export interface OrganizerEntry extends Organizer {
  discord: string;
}

export interface OrganizerPatch {
  name?: string;
  slug?: string;
  aliases?: string[];
  /** Empty string clears the field; absent key leaves it untouched. */
  linear?: string;
  notion?: string;
  sentry?: string;
  github?: string;
  figma?: string;
}

export interface UpsertResult {
  organizer: Organizer;
  set: EditablePlatform[];
  cleared: EditablePlatform[];
}
