import { z } from "zod";

/** Shared per_page/page input fields — spread into a tool's `z.object({...})`. */
export const paginationInputShape = {
  per_page: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
  page: z.number().int().min(1).optional().describe("Page number (default 1)"),
};
