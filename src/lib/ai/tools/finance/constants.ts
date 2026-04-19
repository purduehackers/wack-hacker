import { z } from "zod";

/** Shared per_page/page input fields — spread into a tool's `z.object({...})`. */
export const paginationInputShape = {
  per_page: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
  page: z.number().int().min(1).optional().describe("Page number (default 1)"),
};

/** Validate an ISO date (YYYY-MM-DD) so `Date.parse` never silently yields NaN downstream. */
export const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/,
    "Expected ISO date (YYYY-MM-DD)",
  );
