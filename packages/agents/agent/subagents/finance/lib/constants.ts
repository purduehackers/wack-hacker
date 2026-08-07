import { z } from "zod";

export const perPageField = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Page size (default 50)");
export const pageField = z.number().int().min(1).optional().describe("Page number (default 1)");
export const paginationInputShape = { per_page: perPageField, page: pageField };
export const paginationInputSchema = z.object(paginationInputShape);
