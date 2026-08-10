import { z } from "zod";

import { cursorPaginationInputShape, notionSortSchema } from "../../notion/lib/shared-constants.ts";

/**
 * Filter/sort/paginate arguments every CRM list tool accepts. Spread it, then
 * override `filter` with a data-source specific `.describe()` where it helps.
 *
 * The pagination and sort pieces are Notion's, imported rather than copied —
 * this file used to be `notion/lib/shared-constants.ts` verbatim plus this one
 * export, and the copy had already started to drift.
 */
export const crmQueryInputShape = {
  filter: z.record(z.string(), z.json()).optional(),
  sorts: z.array(notionSortSchema).optional(),
  ...cursorPaginationInputShape,
};
