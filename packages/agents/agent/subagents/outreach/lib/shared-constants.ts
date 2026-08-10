import { z } from "zod";

/** Cursor-style pagination (Notion, Sales SDK). Spread into a tool's `z.strictObject({...})`. */
export const cursorPaginationInputShape = {
  page_size: z.int().min(1).max(100).optional(),
  start_cursor: z.string().optional(),
};

/**
 * A Notion data-source sort target. The API wants exactly one of `property` or
 * `timestamp`; `isQuerySorts` enforces that exclusivity once the input parses.
 */
export const notionSortSchema = z.strictObject({
  property: z.string().optional(),
  timestamp: z.enum(["created_time", "last_edited_time"]).optional(),
  direction: z.enum(["ascending", "descending"]),
});

/**
 * Filter/sort/paginate arguments every CRM list tool accepts. Spread it, then
 * override `filter` with a data-source specific `.describe()` where it helps.
 */
export const crmQueryInputShape = {
  filter: z.record(z.string(), z.json()).optional(),
  sorts: z.array(notionSortSchema).optional(),
  ...cursorPaginationInputShape,
};
