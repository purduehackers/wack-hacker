/**
 * @fileoverview Input fields shared across this domain's tools.
 *
 * Payload exposes nine collections through one REST shape, so every
 * collection needs the same two things here:
 *
 * - the pagination fields its list tool accepts,
 * - the writable fields its create tool requires and its update tool takes a
 *   partial of.
 *
 * Declaring each once keeps a create and its update from drifting apart.
 * That drift is the failure this domain is most prone to — an update that
 * silently accepts a field the create does not. The projections that rename
 * Payload's columns for the model live in `./projections.ts`.
 */

import { z } from "zod";

import { documentId } from "./client.ts";

/** Shared limit/page/sort input fields — spread into a tool's `z.strictObject({...})`. */
export const paginationInputShape = {
  limit: z
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max documents to return per page (default 25, max 100)"),
  page: z.int().min(1).optional().describe("1-indexed page number (default 1)"),
  sort: z
    .string()
    .optional()
    .describe('Field to sort by. Prefix with "-" for descending (e.g. "-createdAt")'),
};

/**
 * ISO 8601 date-time as Payload's `date` fields accept it: UTC (`…Z`), an explicit
 * offset (`…+05:00`), or a bare local time (`…T18:00:00`).
 */
export const cmsDatetime = z.iso.datetime({ offset: true, local: true });

/** Roles defined in purduehackers/cms src/collections/auth-utils.ts. */
export const cmsRole = z.enum([
  "admin",
  "editor",
  "viewer",
  "hack_night_dashboard",
  "events_website",
  "wack_hacker",
]);

/** Writable event fields. `create_event` requires them. `update_event` takes the partial. */
export const eventFields = {
  name: z.string(),
  start: cmsDatetime.describe("ISO 8601 datetime for event start"),
  end: cmsDatetime.optional().describe("ISO 8601 datetime for event end"),
  event_type: z.string().optional().describe("Event type (default 'hack-night')"),
  location_name: z.string().optional(),
  location_url: z.url().optional(),
  description: z.string().describe("Plain text description"),
  published: z.boolean().optional(),
};

/** Writable RSVP fields. `create_rsvp` requires them. `update_rsvp` takes the partial. */
export const rsvpFields = {
  event_id: documentId,
  email: z.email(),
  name: z.string(),
  unsubscribed: z.boolean().optional(),
};

/** Writable email fields. `create_email` requires them. `update_email` takes the partial. */
export const emailFields = {
  event_id: documentId,
  subject: z.string(),
  body: z.string().describe("Plain-text or HTML email body"),
};

/** Writable session fields. Create requires them. Update takes the partial. */
export const sessionFields = {
  title: z.string(),
  date: cmsDatetime.describe("ISO 8601 datetime"),
  host_preferred_name: z.string(),
  host_discord_id: z.string(),
  description: z.string(),
  published: z.boolean().optional(),
};

/** Writable ugrant fields. Create requires them. Update takes the partial. */
export const ugrantFields = {
  name: z.string(),
  author: z.string(),
  description: z.string(),
  image_id: documentId,
  author_url: z.url().optional(),
  project_url: z.url().optional(),
  visible: z.boolean().optional(),
};

/** Writable shelter-project fields. Create requires them. Update takes the partial. */
export const shelterProjectFields = {
  name: z.string(),
  last_division: z.string(),
  last_owner: z.string(),
  description: z.string(),
  image_id: documentId,
  visible: z.boolean().optional(),
};

/** Writable user fields. Create requires them. Update takes the partial minus `password`. */
export const userFields = {
  email: z.email(),
  password: z.string().min(8).describe("Initial password (user can change it after login)"),
  roles: z.array(cmsRole).min(1),
};

/** Writable service-account fields. Create requires them. Update takes the partial. */
export const serviceAccountFields = {
  name: z.string(),
  roles: z.array(cmsRole).min(1),
  revoked: z.boolean().optional(),
};
