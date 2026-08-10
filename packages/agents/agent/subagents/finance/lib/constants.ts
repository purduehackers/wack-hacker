import { z } from "zod";

export const paginationInputShape = {
  per_page: z.int().min(1).max(100).optional().describe("Page size (default 50)"),
  page: z.int().min(1).optional().describe("Page number (default 1)"),
};
export const paginationInputSchema = z.object(paginationInputShape);
