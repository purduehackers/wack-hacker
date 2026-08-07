import { z } from "zod";

export const perPageField = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Page size (default 50)");

export const pageField = z.number().int().min(1).optional().describe("Page number (default 1)");

/** Offset-style pagination. Spread into a tool's `z.object({...})`. */
export const paginationInputShape = {
  per_page: perPageField,
  page: pageField,
};

export const pageSizeField = z.number().int().min(1).max(100).optional();

export const startCursorField = z.string().optional();

/** Cursor-style pagination (Notion, Sales SDK). Spread into a tool's `z.object({...})`. */
export const cursorPaginationInputShape = {
  page_size: pageSizeField,
  start_cursor: startCursorField,
};
