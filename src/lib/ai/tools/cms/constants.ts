import { z } from "zod";

/** Shared limit/page/sort input fields — spread into a tool's `z.object({...})`. */
export const paginationInputShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max documents to return per page (default 25, max 100)"),
  page: z.number().int().min(1).optional().describe("1-indexed page number (default 1)"),
  sort: z
    .string()
    .optional()
    .describe('Field to sort by. Prefix with "-" for descending (e.g. "-createdAt")'),
};
