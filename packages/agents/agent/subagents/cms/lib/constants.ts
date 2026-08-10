import { z } from "zod";

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
